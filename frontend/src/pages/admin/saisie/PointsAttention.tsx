import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { appliquerDecisions, lireLigne, simulerDecisions, type AnomalieLot, type Decisions, type LigneLot, type Lot } from '../../../api/saisie'
import { Bouton } from '../../../components/Kit'
import { MOIS, valeurBrute } from '../../../lib/format'
import ListeChoix, { ID_LISTE, idOption } from './ListeChoix'
import Volet from './Volet'

type Niveau = 'corriger' | 'confirmer' | 'auto' | 'info'

const NIVEAUX: Record<Niveau, { libelle: string; ton?: 'ko' | 'attention' }> = {
  corriger: { libelle: 'À corriger', ton: 'ko' },
  confirmer: { libelle: 'À confirmer', ton: 'attention' },
  auto: { libelle: 'Corrigé automatiquement' },
  info: { libelle: 'Pour information' },
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

/** Chaque point tombe dans le premier groupe qui le retient ; un code inconnu va dans « Montants et listes de valeurs ». */
const GROUPES: Groupe[] = [
  { id: VOLET_ERREURS, titre: 'Erreurs à corriger', niveau: 'corriger', aide: 'bloquent l’enregistrement',
    retenir: (a) => a.gravite === 'bloquant' },
  { id: 'noms', titre: 'Noms et matricules à vérifier', niveau: 'confirmer',
    aide: 'nom différent de celui connu, proche d’un autre employé, matricule douteux ou absent',
    retenir: (a) => codes('NOM_PROCHE', 'NOM_INCOHERENT', 'NOM_SIMILAIRE', 'MATRICULE_DOUTEUX', 'MATRICULE_NUMERIQUE', 'SANS_MATRICULE')(a)
      || (a.code === 'VALEUR_MANQUANTE' && a.colonne === 'Noms') },
  { id: 'affectation', titre: 'Changements d’affectation', niveau: 'confirmer',
    aide: 'service, site, contrat ou activité différents selon les mois : mutation ou erreur ?', retenir: codes('MUTATION') },
  { id: 'liaisons', titre: 'Cellules liées à un autre fichier', niveau: 'info',
    aide: 'valeurs reprises du dernier calcul d’Excel, rien à faire ici', retenir: codes('LIAISON_EXTERNE') },
  { id: 'auto', titre: 'Valeurs corrigées automatiquement', niveau: 'auto',
    aide: 'espaces, casse, nombres en texte, arrondis, colonnes ignorées',
    retenir: codes('NORMALISE', 'TEXTE_CONVERTI', 'ENTETE_INCONNU', 'ENTETE_ALIAS') },
  { id: 'montants', titre: 'Montants et listes de valeurs', niveau: 'confirmer', aide: 'montants inhabituels, Brut Réel, mois différent, postes nouveaux ou vides',
    retenir: () => true },
]

/** Point qui attend une décision (volet « À confirmer ») : on n'avance pas tant qu'il reste sans solution. */
export function aConfirmer(a: AnomalieLot) {
  return GROUPES.find((g) => g.retenir(a))!.niveau === 'confirmer' && decisions(a) !== null
}

/** Ordre d'affichage : à corriger, à confirmer, corrigé automatiquement, pour information. */
const ORDRE: Niveau[] = ['corriger', 'confirmer', 'auto', 'info']

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
  /** Pied de l'écran où placer « Annuler (n modifications) » et « Enregistrer ». */
  pied?: HTMLElement | null
  /** Écran de vérification : rien ne se modifie, on revient à l'étape précédente pour corriger. */
  lectureSeule?: boolean
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
  const acceptes: string[] = []
  for (const { decision: d, ligne } of Object.values(p.choix)) {
    if (d.accepter) acceptes.push(d.accepter)
    if (d.valeurs) lignes[ligne] = { ...lignes[ligne], ...d.valeurs }
    for (const [n, v] of Object.entries(d.parLigne ?? {})) lignes[+n] = { ...lignes[+n], ...v }
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
  return { lignes, ajouts: [...ajouts.values()], retirees: [...retirees], ignores: [...p.ignores, ...acceptes] }
}

/** Ce que le détail d'un point lit et change dans le plan commun. */
interface Edition {
  plan: Plan
  lignes: Decisions['lignes']
  /** Clés des points encore présents (après vérification des changements en attente). */
  restants: Set<string>
  occupe: boolean
  setPlan: (f: (p: Plan) => Plan) => void
  lectureSeule?: boolean
}

/** Points regroupés par nature et par niveau (à corriger, à confirmer, corrigé automatiquement). */
export default function PointsAttention({ anomalies, lotId, onLot, onAttente, afficherLigne, ouvert, onOuvrir, pied, lectureSeule }: Props) {
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
  const edition: Edition = { plan, lignes: envoi?.lignes ?? {}, restants, occupe, setPlan, lectureSeule }
  const erreur = enregistrer.error ?? (envoi ? simulation.error : null)
  // Barre des corrections : dans le pied de l'écran quand il est fourni, sinon sous les volets.
  const barre = lotId != null && afficherLigne && !lectureSeule && (n > 0 || erreur) ? (
    <span className="corrections-pied">
      {n > 0 && (sansType || (envoi && simulation.isFetching)) && (
        <span className="muted" aria-live="polite">
          {sansType ? 'Choisir le type du nouveau site' : 'Vérification…'}
        </span>
      )}
      {erreur && <span className="champ-erreur" role="alert">{erreur.message}</span>}
      {n > 0 && <Bouton variante="secondaire" className="bouton-annuler" disabled={occupe} onClick={() => setPlan(() => VIDE)}>{`Annuler (${n} modification${n > 1 ? 's' : ''})`}</Bouton>}
      {n > 0 && (
        <Bouton disabled={occupe || sansType} onClick={() => enregistrer.mutate()}>
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </Bouton>
      )}
    </span>
  ) : null
  return (
    <>
      {repartir(tous).map((g) => {
        const reste = g.lignes.filter((a) => restants.has(cle(a))).length
        return (
          <Volet key={g.id} titre={g.titre} valeur={reste} ton={reste === 0 ? 'ok' : NIVEAUX[g.niveau].ton}
            resume={<><span className="volet-niveau">{NIVEAUX[g.niveau].libelle}</span> : {g.aide}</>}
            ouvert={ouvert === g.id} onOuvrir={() => onOuvrir(g.id)}>
            {g.id === 'auto' && lotId != null && afficherLigne && !lectureSeule
              && g.lignes.some((a) => CODES_AUTO.includes(a.code) && restants.has(cle(a)) && !plan.choix[cle(a)]) && (
              <p className="actions-volet">
                <Bouton variante="secondaire" disabled={occupe} onClick={() => setPlan((p) => toutConserver(g.lignes, p))}>Tout conserver</Bouton>
              </p>
            )}
            <Tableau lignes={g.lignes} tous={tous} lotId={lotId} afficherLigne={afficherLigne}
              ton={NIVEAUX[g.niveau].ton} edition={lotId != null && g.niveau !== 'info' ? edition : undefined} />
          </Volet>
        )
      })}
      {barre && (pied ? createPortal(barre, pied) : barre)}
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
  const table = useRef<HTMLTableElement>(null)
  // Ligne dépliée placée juste sous l'en-tête figé : son détail et les lignes suivantes restent visibles.
  useEffect(() => {
    const tr = deplie && table.current?.querySelector<HTMLElement>('tr[data-ouvert]')
    if (!tr) return
    tr.style.scrollMarginTop = `${table.current!.tHead?.offsetHeight ?? 0}px`
    const doux = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    tr.scrollIntoView?.({ block: 'start', behavior: doux ? 'smooth' : 'auto' })
    // Le détail se charge après coup et agrandit le volet : la ligne est replacée quand il arrive.
    if (typeof ResizeObserver === 'undefined') return
    let premier = true
    const suivi = new ResizeObserver(() => {
      if (premier) { premier = false; return }
      tr.scrollIntoView?.({ block: 'start', behavior: doux ? 'smooth' : 'auto' })
    })
    suivi.observe(table.current!)
    const fin = window.setTimeout(() => suivi.disconnect(), 2000)
    return () => { suivi.disconnect(); window.clearTimeout(fin) }
  }, [deplie])
  return (
    <table ref={table} className={ton ? `dense points bord-${ton}` : 'dense points'}>
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
                data-ouvert={ouvert || undefined}
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
                  points={tous} />
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
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ') || undefined
const sansAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

interface DetailProps {
  lotId: number
  num: number
  cible: string | null
  /** Point déplié : les décisions proposées dépendent de son code. */
  point: AnomalieLot
  /** Points du lot : cellule rouge ou orange tant que le point reste, verte une fois réglé. */
  points: AnomalieLot[]
  edition: Edition
}

/** Liste de valeurs où ajouter une valeur inconnue, selon la colonne. */
const LISTES: Record<string, { dimension: string; pluriel: string }> = {
  Site: { dimension: 'site', pluriel: 'sites' },
  Service: { dimension: 'service', pluriel: 'services' },
  'Activité': { dimension: 'activite', pluriel: 'activités' },
  'Type Contrat': { dimension: 'type_contrat', pluriel: 'types de contrat' },
  Poste: { dimension: 'poste', pluriel: 'postes' },
}

const TYPES_SITE = [['agence', 'Agence'], ['deporte', 'Site déporté'], ['principal', 'Siège / principal']]

/** Décision possible sur un point : ce qu'elle change dans la ligne, ajoute à une liste ou retire du lot. */
interface Decision {
  libelle: string
  valeurs?: Record<string, string | null>
  ajout?: { dimension: string; valeur: string }
  retirer?: number[]
  /** « ligne|colonne » : valeur du fichier gardée, point accepté sans rien changer. */
  accepter?: string
  /** Valeurs posées sur d'autres lignes (toutes celles du même employé). */
  parLigne?: Record<number, Record<string, string | null>>
}

/** Mêmes valeurs sur chaque ligne de l'employé. */
function partout(lignes: number[], v: Record<string, string>) {
  return Object.fromEntries(lignes.map((n) => [n, v]))
}

/** Noms et matricules : la décision vaut pour toutes les lignes du même matricule. */
function decisionsNoms(point: AnomalieLot): { question: string; choix: Decision[] } | null {
  const prop = point.proposition
  const n = point.ligne
  if (n == null) return null
  const lignes = prop?.lignes?.length ? prop.lignes : [n]
  const emp = prop?.employe
  if (point.code === 'MATRICULE_DOUTEUX' && emp) {
    return {
      question: `Matricule « ${point.valeur} » inconnu : qui est-ce ?`,
      choix: [{ libelle: `C'est ${emp.nom} (${emp.matricule}) : reprendre son matricule`,
        parLigne: partout(lignes, { MATRICULE: emp.matricule }) },
      { libelle: `Nouvel employé : garder « ${point.valeur} »`, accepter: `${n}|MATRICULE` }],
    }
  }
  if (point.code === 'NOM_SIMILAIRE' && emp) {
    return {
      question: `Nom proche de ${emp.nom} (${emp.matricule}) : même personne ?`,
      choix: [{ libelle: `C'est ${emp.nom} (${emp.matricule}) : remplacer par cet employé`,
        parLigne: partout(lignes, { MATRICULE: emp.matricule, Noms: emp.nom }) },
      { libelle: 'Personne différente', accepter: `${n}|Noms` }],
    }
  }
  if ((point.code === 'NOM_PROCHE' || point.code === 'NOM_INCOHERENT') && prop?.noms?.length) {
    const reg = prop.enregistre
    const garder: Decision[] = reg ? [{ libelle: `Garder le nom enregistré « ${reg} »`, parLigne: partout(lignes, { Noms: reg }) }] : []
    return {
      question: reg ? `Nom différent de celui enregistré (« ${reg} ») : lequel garder ?` : 'Noms différents selon les lignes : lequel garder ?',
      choix: [...garder, ...prop.noms.map((nom) => ({
        libelle: reg ? `Mettre à jour le nom en « ${nom} »` : `Garder « ${nom} »`,
        parLigne: partout(lignes, { Noms: nom }), accepter: `${n}|Noms` }))],
    }
  }
  if (point.code === 'MATRICULE_NUMERIQUE' && point.valeur) {
    return { question: `Matricule « ${point.valeur} » : que faire ?`, choix: [{ libelle: `Garder « ${point.valeur} »`, accepter: `${n}|MATRICULE` }] }
  }
  return null
}

/** Valeurs corrigées d'office : « Conserver » ou « Refuser » (la cellule passe alors en erreur à corriger). */
const CODES_AUTO = ['NORMALISE', 'TEXTE_CONVERTI']

/** Contrôles de vraisemblance : [décision qui garde la valeur du fichier, question]. */
const CONFIRMER: Record<string, [string, string]> = {
  PERIODE_ISOLEE: ['Période confirmée', 'Mois différent du reste du fichier : que faire ?'],
  MONTANT_X10: ['Montant confirmé', 'Montant inhabituel : que faire ?'],
  MONTANT_DIV10: ['Montant confirmé', 'Montant inhabituel : que faire ?'],
  MONTANT_MILLIERS: ['Montant confirmé', 'Montant en milliers ? Que faire ?'],
  BRUT_REEL_ECART: ['Garder le Brut Réel saisi', 'Brut Réel différent de la somme : que faire ?'],
  LIGNE_SANS_MONTANT: ['Confirmer : aucun montant ce mois', 'Ligne sans montant : que faire ?'],
  SANS_MATRICULE: ['Continuer sans matricule', 'Employé sans matricule : que faire ?'],
  SANS_MONTANT: ['Laisser vide (aucun montant)', 'Cellule lue comme vide : que faire ?'],
}

/** « Tout conserver » : la première décision (Conserver) sur chaque correction automatique encore ouverte. */
function toutConserver(lignes: AnomalieLot[], p: Plan): Plan {
  const choix = { ...p.choix }
  for (const a of lignes) {
    const d = decisions(a)
    if (CODES_AUTO.includes(a.code) && d && a.ligne != null && !choix[cle(a)]) choix[cle(a)] = { index: 0, decision: d.choix[0], ligne: a.ligne }
  }
  return { ...p, choix }
}

/** Question posée par la liste et décisions proposées, selon le code du point. Aucune n'est choisie d'office. */
function decisions(point: AnomalieLot): { question: string; choix: Decision[] } | null {
  const col = point.colonne ?? ''
  const prop = point.proposition
  const precedent: Decision[] = prop?.valeur
    ? [{ libelle: `Reprendre la valeur du mois précédent (${prop.valeur}, ${prop.periode})`, valeurs: { [col]: prop.valeur } }]
    : []
  if (point.code === 'LIGNE_TOTAL') {
    return { question: 'Ligne de total : que faire ?', choix: [{ libelle: 'Supprimer la ligne', retirer: [point.ligne!] }] }
  }
  const noms = decisionsNoms(point)
  if (noms) return noms
  if (point.code === 'MUTATION' && prop?.valeur && point.ligne != null) {
    return {
      question: 'Mutation ou erreur ?',
      choix: [{ libelle: 'Changement à partir de ce mois', accepter: `${point.ligne}|${col}` },
        { libelle: `Erreur : garder « ${prop.valeur} » (${prop.periode})`, valeurs: { [col]: prop.valeur } }],
    }
  }
  if (CODES_AUTO.includes(point.code) && point.ligne != null && col) {
    return {
      question: 'Correction automatique : la garder ?',
      choix: [{ libelle: 'Conserver', accepter: `${point.ligne}|${col}` },
        { libelle: 'Refuser : je saisis la bonne valeur', accepter: `!${point.ligne}|${col}` }],
    }
  }
  const confirmer = CONFIRMER[point.code]
  if (confirmer && point.ligne != null && col) {
    return {
      question: confirmer[1],
      choix: [{ libelle: confirmer[0], accepter: `${point.ligne}|${col}` },
        ...(prop?.corrections ?? []).map((c) => ({ libelle: c.libelle, valeurs: { [col]: c.valeur } })),
        ...(point.code === 'LIGNE_SANS_MONTANT' ? [{ libelle: 'Supprimer la ligne', retirer: [point.ligne] }] : [])],
    }
  }
  if (point.code === 'MONTANT_NEGATIF' && point.ligne != null && point.valeur) {
    const positif = point.valeur.trim().replace(/^[-−]\s*/, '')
    return {
      question: 'Montant négatif : régularisation ou erreur de signe ?',
      choix: [{ libelle: 'Régularisation confirmée', accepter: `${point.ligne}|${col}` },
        { libelle: `Corriger en ${positif}`, valeurs: { [col]: positif } }],
    }
  }
  const liste = LISTES[col]
  if ((point.code === 'REFERENTIEL_INCONNU' || point.code === 'POSTE_NOUVEAU') && liste && point.valeur) {
    // Une seule décision pour toutes les lignes qui portent cette valeur.
    const lignes = prop?.lignes?.length ? prop.lignes : point.ligne != null ? [point.ligne] : []
    const remplacer: Decision[] = prop?.proche
      ? [{ libelle: `Remplacer par « ${prop.proche} »`, parLigne: partout(lignes, { [col]: prop.proche }) }]
      : []
    return {
      question: `${col} « ${point.valeur} » absent de la liste des ${liste.pluriel}${lignes.length > 1 ? ` (${lignes.length} lignes)` : ''} : que faire ?`,
      choix: [{ libelle: col === 'Poste' ? `Créer le poste « ${point.valeur} »` : `Ajouter « ${point.valeur} » à la liste des ${liste.pluriel}`,
        ajout: { dimension: prop?.dimension ?? liste.dimension, valeur: point.valeur } }, ...remplacer, ...precedent],
    }
  }
  if (prop?.corrections?.length) {
    return {
      question: point.code === 'SEPARATEUR_AMBIGU' ? `« ${point.valeur} » : quelle lecture ?`
        : point.valeur ? `« ${point.valeur} » : que faire ?` : `${col} vide : que faire ?`,
      choix: prop.corrections.map((c) => ({ libelle: c.libelle, valeurs: { [col]: c.valeur } })),
    }
  }
  if (point.code === 'VALEUR_MANQUANTE' && point.gravite !== 'bloquant' && point.ligne != null && col) {
    return { question: `${col} vide : que faire ?`, choix: [...precedent, { libelle: 'Laisser vide', accepter: `${point.ligne}|${col}` }] }
  }
  if (point.code === 'VALEUR_MANQUANTE' && precedent.length) return { question: `${col} vide : que faire ?`, choix: precedent }
  if (point.code === 'DOUBLON' && prop?.lignes && prop.lignes.length > 1) {
    return {
      question: 'Employé sur plusieurs lignes du même mois : quelle ligne garder ?',
      choix: prop.lignes.map((n) => {
        const autres = prop.lignes!.filter((x) => x !== n)
        return {
          libelle: `Garder la ligne ${n}, supprimer ${autres.length > 1 ? 'les lignes' : 'la ligne'} ${autres.join(', ')}`,
          retirer: autres,
        }
      }),
    }
  }
  return null
}

/** Montants illisibles ou douteux : la cellule peut rester vide. */
const MONTANT_VIDE = ['SANS_MONTANT', 'NON_NUMERIQUE', 'SEPARATEUR_AMBIGU', 'MONTANT_HORS_BORNES']

/** Seules les cellules qui peuvent rester vides s'ignorent (montants, nom, poste) ; jamais une colonne obligatoire. */
function ignorable(a: AnomalieLot) {
  if (!a.colonne) return false
  if (MONTANT_VIDE.includes(a.code)) return !ATTRIBUTS.some(([n]) => n === a.colonne)
  return ['VALEUR_MANQUANTE', 'TEXTE_TROP_LONG'].includes(a.code) && ['Noms', 'Poste'].includes(a.colonne)
}

/** Sous le point, comme le détail par contrat : la ligne du fichier (en-tête et valeurs), cellules en cause surlignées. */
function DetailLigne({ lotId, num, cible, point, points, edition }: DetailProps) {
  // Doublon : toutes les lignes en cause, dans l'ordre du fichier, pour les comparer.
  const ordre = point.code === 'DOUBLON' && (point.proposition?.lignes?.length ?? 0) > 1
    ? [...point.proposition!.lignes!].sort((a, b) => a - b) : [num]
  const qs = useQueries({ queries: ordre.map((n) => ({ queryKey: ['saisie', 'ligne', lotId, n], queryFn: () => lireLigne(lotId, n) })) })
  const q = qs[ordre.indexOf(num)]
  const comparer = ordre.length > 1
  // Mêmes colonnes sur chaque ligne comparée.
  const colonnes = [...new Set(qs.flatMap((x) => Object.keys(x.data?.montants ?? {})))]
  const { plan, setPlan, occupe } = edition
  const k = cle(point)
  const c = cellule(point)
  const proposees = decisions(point)
  const choisi = plan.choix[k]
  const ignore = plan.ignores.includes(c)
  const nouveauSite = choisi?.decision.ajout?.dimension === 'site' ? choisi.decision.ajout.valeur : null
  const regle = !edition.restants.has(k) && choisi == null && !ignore
  // Choisir une solution annule « ignorer » sur la même cellule, et inversement.
  const choisir = (i: number) => setPlan((p) => ({
    ...p, ignores: p.ignores.filter((x) => x !== c),
    choix: { ...p.choix, [k]: { index: i, decision: proposees!.choix[i], ligne: num } },
  }))
  // Sans valeur : annule le choix fait sur ce point seulement.
  const ignorer = (garder = true) => setPlan((p) => {
    const choix = { ...p.choix }
    delete choix[k]
    return { ...p, choix, ignores: [...p.ignores.filter((x) => x !== c), ...(garder ? [c] : [])] }
  })
  const question = proposees?.question
    ?? `${point.colonne}${point.valeur ? ` « ${point.valeur} »` : ' vide'} : que faire ?`
  // Revenir à la valeur du fichier efface la modification ; saisir une valeur annule « ignorer » sur la cellule.
  const modifier = (n: number, brut: Record<string, string | null>) => (col: string, v: string | null) => setPlan((p) => {
    const ligne = { ...p.modifs[n] }
    delete ligne[col]
    if (v !== (brut[col] ?? null)) ligne[col] = v
    const modifs = { ...p.modifs, [n]: ligne }
    if (!Object.keys(ligne).length) delete modifs[n]
    return { ...p, modifs, ignores: p.ignores.filter((x) => x !== `${n}|${col}`) }
  })
  const tout = qs.every((x) => x.isSuccess)
  return (
    <tr className={edition.restants.has(k) ? 'detail-contrat' : 'detail-contrat detail-regle'}>
      <td colSpan={5} className={comparer ? 'comparer' : undefined}>
        {tout ? (
          <>
            {/* Doublon : un seul en-tête, les lignes en cause l'une sous l'autre. */}
            <LigneFichier signalee={num} cible={cible} colonnes={comparer ? colonnes : undefined}
              restants={edition.restants} enCours={occupe}
              rangs={ordre.map((n, i) => {
                const d = qs[i].data!
                return { num: n, l: d, points: points.filter((x) => x.ligne === n), modifs: edition.lignes[n],
                  onModifie: d.brut && !edition.lectureSeule ? modifier(n, d.brut) : undefined }
              })} />
            {q.data!.brut && (regle
              ? <p className="actions-point regle">Point réglé.</p>
              : edition.lectureSeule
                ? <p className="actions-point">Valeur lue gardée. Pour la changer, revenez à l'étape précédente et corrigez le fichier.</p>
              : !(proposees || ignorable(point))
                ? <p className="actions-point">{point.gravite === 'bloquant'
                  ? 'Veuillez saisir une valeur conforme : cliquez sur la cellule en cause pour la corriger.'
                  : 'Valeur lue gardée. Pour la changer, cliquez sur la cellule en cause.'}</p>
                : (
                <div className="actions-point">
                  <label className="decision">
                    <span>{question}</span>
                    <select value={ignore ? 'ignorer' : (choisi?.index ?? '')} disabled={occupe}
                      onChange={(e) => (e.target.value === 'ignorer' || e.target.value === ''
                        ? ignorer(e.target.value === 'ignorer') : choisir(Number(e.target.value)))}>
                      {choisi || ignore
                        ? <option value="">Annuler ce choix (garder la valeur du fichier)</option>
                        : <option value="" disabled>Choisir une solution…</option>}
                      {proposees?.choix.map((d, i) => <option key={d.libelle} value={i}>{d.libelle}</option>)}
                      {/* Une décision « Laisser vide » existe déjà : pas de second choix au même effet. */}
                      {ignorable(point) && !proposees?.choix.some((d) => d.libelle.startsWith('Laisser vide')) && <option value="ignorer">Ignorer la valeur (laisser vide)</option>}
                    </select>
                  </label>
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
                </div>
              ))}
          </>
        )
          : <span className="muted">{qs.some((x) => x.isPending) ? 'Chargement…' : 'Contenu indisponible.'}</span>}
      </td>
    </tr>
  )
}


/** Ligne du fichier montrée sous le point ; plusieurs pour un doublon. */
interface Rang {
  num: number
  l: LigneLot
  points: AnomalieLot[]
  /** Valeurs changées, pas encore enregistrées. */
  modifs?: Record<string, string | null>
  /** Absent : ligne en lecture seule (lot analysé avant les corrections sur place). */
  onModifie?: (colonne: string, valeur: string | null) => void
}

interface LigneProps {
  rangs: Rang[]
  /** Ligne du point déplié : seule sa cellule en cause est ciblée. */
  signalee: number
  cible: string | null
  /** Rubriques à afficher en plus de celles des lignes (lignes comparées). */
  colonnes?: string[]
  /** Clés des points encore présents ; absent : tous. */
  restants?: Set<string>
  enCours?: boolean
}

function LigneFichier({ rangs, signalee, cible, colonnes = [], restants, enCours }: LigneProps) {
  const [edition, setEdition] = useState<{ num: number; col: string; valeur: string; actif: number; saisi?: boolean } | null>(null)
  const [ancre, setAncre] = useState<HTMLElement | null>(null)
  const comparer = rangs.length > 1
  // Lignes comparées : leur numéro en tête, figé avec ANNÉE, MOIS, MATRICULE, Noms.
  const figees = FIGEES + (comparer ? 1 : 0)
  const rang = edition ? rangs.find((r) => r.num === edition.num) : undefined
  const ouvrir = (r: Rang, n: string) => {
    ferme.current = false
    setEdition({ num: r.num, col: n, valeur: (r.modifs && n in r.modifs ? r.modifs[n] : r.l.brut?.[n]) ?? '', actif: -1 })
  }
  // Comme la grille de saisie : valeur vide ou connue, toutes les valeurs ; sinon celles qui la contiennent.
  // À l'ouverture ou sans valeur qui corresponde (valeur inconnue du fichier), la liste entière reste proposée.
  const toutes = edition ? (edition.col === 'MOIS' ? MOIS : rang?.l.choix?.[edition.col]) ?? [] : []
  const tape = sansAccents(edition?.valeur.trim() ?? '')
  const filtrees = toutes.filter((o) => sansAccents(o).includes(tape))
  const options = !edition?.saisi || !tape || !filtrees.length || toutes.some((o) => sansAccents(o) === tape) ? toutes : filtrees
  // Échap ou Entrée retire le champ, ce qui déclenche aussi sa perte de focus : une seule fermeture compte.
  const ferme = useRef(false)
  const fermer = (garder: boolean, choisie?: string) => {
    if (!edition || ferme.current) return
    ferme.current = true
    const v = (choisie ?? edition.valeur).trim()
    setEdition(null)
    if (garder) rang?.onModifie?.(edition.col, v || null)
  }
  const reste = (p: AnomalieLot) => !restants || restants.has(cle(p))
  const rubriques = [...new Set([...rangs.flatMap((r) => [...Object.keys(r.l.montants), ...r.points.map((p) => p.colonne ?? '')]), ...colonnes])]
    .filter((c) => c && !ATTRIBUTS.some(([n]) => n === c))
  const cellules = (l: LigneLot): [string, string | null][] => [
    ...ATTRIBUTS.map(([n, f]): [string, string | null] => [n, f(l)]),
    ...rubriques.map((r): [string, string | null] => [r, l.montants[r] != null ? valeurBrute(l.montants[r]) : null]),
  ]
  const noms = cellules(rangs[0].l).map(([n]) => n)
  const cadre = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const div = cadre.current
    if (!div) return
    // Le tableau des points peut être plus large que son volet : la ligne du fichier se limite à la partie visible.
    const volet = div.closest<HTMLElement>('.volet-corps')
    if (volet) div.style.width = `${volet.clientWidth - 3}px`
    // Colonnes figées : chacune se cale à droite des précédentes.
    const entetes = [...div.querySelectorAll<HTMLElement>('thead th')]
    for (let i = 0; i < figees; i++) {
      div.querySelectorAll<HTMLElement>(`tr > :nth-child(${i + 1})`).forEach((c) => { c.style.left = `${entetes[i].offsetLeft - entetes[0].offsetLeft}px` })
    }
    const gauche = entetes[figees].offsetLeft - entetes[0].offsetLeft
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
      <table className="dense points" aria-label={comparer ? `Lignes ${rangs.map((r) => r.num).join(' et ')} du fichier` : `Ligne ${signalee} du fichier`}>
        <thead>
          <tr>
            {comparer && <th scope="col" className="fige num-ligne">Ligne</th>}
            {noms.map((n, j) => {
              const i = j + (comparer ? 1 : 0)
              return <th key={n} scope="col" className={cx(i < figees && 'fige', i === figees - 1 && 'fige-bord')}>{n}</th>
            })}
          </tr>
        </thead>
        <tbody>
          {rangs.map((r) => {
            const { l, num, modifs = {}, onModifie } = r
            // Un point restant l'emporte sur un point réglé de la même colonne.
            const parColonne = new Map([...r.points].sort((a, b) => Number(reste(a)) - Number(reste(b))).map((p) => [p.colonne, p]))
            return (
              <tr key={num}>
                {comparer && <th scope="row" className="fige num-ligne">{num}</th>}
                {cellules(l).map(([n, brute], j) => {
                  const i = j + (comparer ? 1 : 0)
                  const change = n in modifs
                  const v = change ? modifs[n] : brute
                  const p = parColonne.get(n)
                  const ok = p != null && !reste(p)
                  const classe = cx(ok && 'cellule-ok', p && !ok && !change && (p.gravite === 'bloquant' ? 'cellule-ko' : 'cellule-attention'),
                    change && !ok && 'cellule-modifiee',
                    num === signalee && n === cible && 'cellule-cible', i < figees && 'fige', i === figees - 1 && 'fige-bord')
                  const modifiable = onModifie != null && l.brut != null && n in l.brut && !enCours
                  if (edition?.num === num && edition.col === n) {
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
                      <td key={n} ref={setAncre} className={cx(classe, 'en-saisie')} title={p?.message}>
                        {/* Valeur gardée, invisible : la cellule garde sa taille, le champ se pose dessus. */}
                        <span className="fantome" aria-hidden="true">{change ? v : v ?? p?.valeur ?? ''}</span>
                        <input autoFocus aria-label={`${n}, ligne ${num}`} value={edition.valeur}
                          {...(toutes.length ? {
                            role: 'combobox', 'aria-autocomplete': 'list' as const, 'aria-expanded': ouverte,
                            'aria-controls': ouverte ? ID_LISTE : undefined,
                            'aria-activedescendant': ouverte && edition.actif >= 0 ? idOption(edition.actif) : undefined,
                          } : {})}
                          onChange={(e) => setEdition({ num, col: n, valeur: e.target.value, actif: -1, saisi: true })} onBlur={() => fermer(true)}
                          onKeyDown={touche} />
                        {ouverte && ancre && (
                          <ListeChoix ancre={ancre} options={options} actif={edition.actif} valeur={edition.valeur}
                            onChoisir={(o) => fermer(true, o)} onSurvol={(k) => setEdition({ ...edition, actif: k })} />
                        )}
                      </td>
                    )
                  }
                  return (
                    <td key={n} className={cx(classe, modifiable && 'modifiable')} title={p?.message}
                      onClick={modifiable ? () => ouvrir(r, n) : undefined}>{change ? v : v ?? p?.valeur ?? ''}</td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
