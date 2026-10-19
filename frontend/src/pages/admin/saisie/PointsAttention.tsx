import { Fragment, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { corrigerLigne, lireLigne, type AnomalieLot, type LigneLot, type Lot } from '../../../api/saisie'
import { MOIS, valeurBrute } from '../../../lib/format'
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
    aide: 'espaces, casse, nombres en texte, arrondis, colonnes ignorées',
    retenir: codes('NORMALISE', 'TEXTE_CONVERTI', 'PRECISION_TRONQUEE', 'ENTETE_INCONNU', 'ENTETE_ALIAS') },
  { id: 'montants', titre: 'Montants et référentiels', niveau: 'confirmer', aide: 'montants négatifs, postes nouveaux ou vides',
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
  /** Lot renvoyé après une correction sur place (contrôles relancés). */
  onLot?: (lot: Lot) => void
  /** Numéro de ligne du fichier : sans objet pour une saisie en grille. */
  afficherLigne: boolean
  /** Volet ouvert, partagé avec le reste de l'aperçu : un seul à la fois. */
  ouvert: string | null
  onOuvrir: (id: string) => void
}

/** Points regroupés par nature et par niveau (à corriger, à confirmer, corrigé automatiquement). */
export default function PointsAttention({ anomalies, lotId, onLot, afficherLigne, ouvert, onOuvrir }: Props) {
  return (
    <>
      {repartir(anomalies).map((g) => (
        <Volet key={g.id} titre={g.titre} valeur={g.lignes.length} ton={NIVEAUX[g.niveau].ton}
          resume={<><span className="volet-niveau">{NIVEAUX[g.niveau].libelle}</span> : {g.aide}</>}
          ouvert={ouvert === g.id} onOuvrir={() => onOuvrir(g.id)}>
          <Tableau lignes={g.lignes} tous={anomalies} lotId={lotId} onLot={onLot} afficherLigne={afficherLigne} ton={NIVEAUX[g.niveau].ton} />
        </Volet>
      ))}
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
  onLot?: (lot: Lot) => void
  afficherLigne: boolean
  /** Couleur de la bordure du détail déplié : celle du niveau du volet. */
  ton?: 'ko' | 'attention'
}

const cle = (a: AnomalieLot) => `${a.ligne}|${a.colonne}|${a.code}`

function Tableau({ lignes, tous, lotId, onLot, afficherLigne, ton }: TableauProps) {
  // Point déplié repéré par sa clé : après une correction, s'il a disparu, la même ligne reste ouverte sur le point suivant.
  const [deplie, setDeplie] = useState<{ ligne: number; cle: string } | null>(null)
  const meme = deplie ? lignes.findIndex((a) => cle(a) === deplie.cle) : -1
  const iDeplie = meme >= 0 || !deplie ? meme : lignes.findIndex((a) => a.ligne === deplie.ligne)
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
          const depliable = afficherLigne && lotId != null && ancrable(a)
          const ouvert = depliable && iDeplie === i
          return (
            <Fragment key={`${cle(a)}|${i}`}>
              <tr>
                {afficherLigne && (
                  <td className={ouvert ? 'num ouvert' : 'num'}>
                    {depliable ? (
                      <button type="button" className="deplier" aria-expanded={ouvert} aria-label={`Détail de la ligne ${a.ligne}`}
                        onClick={() => setDeplie(ouvert ? null : { ligne: a.ligne!, cle: cle(a) })}>
                        <span aria-hidden="true">{ouvert ? '▾' : '▸'}</span> {a.ligne}
                      </button>
                    ) : (a.ligne ?? '')}
                  </td>
                )}
                <td>{employe(a)}</td>
                <td>{a.colonne}</td>
                <td>{a.valeur}</td>
                <td>{a.message}</td>
              </tr>
              {ouvert && (
                <DetailLigne lotId={lotId!} num={a.ligne!} cible={a.colonne} onLot={onLot}
                  points={tous.filter((x) => x.ligne === a.ligne)} />
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

interface DetailProps {
  lotId: number
  num: number
  cible: string | null
  points: AnomalieLot[]
  onLot?: (lot: Lot) => void
}

/** Sous le point, comme le détail par contrat : la ligne du fichier (en-tête et valeurs), cellules en cause surlignées. */
function DetailLigne({ lotId, num, cible, points, onLot }: DetailProps) {
  const q = useQuery({ queryKey: ['saisie', 'ligne', lotId, num], queryFn: () => lireLigne(lotId, num) })
  const qc = useQueryClient()
  const corriger = useMutation({
    mutationFn: (valeurs: Record<string, string | null>) => corrigerLigne(lotId, num, valeurs),
    onSuccess: (lot) => {
      void qc.invalidateQueries({ queryKey: ['saisie'] })
      onLot?.(lot)
    },
  })
  return (
    <tr className="detail-contrat">
      <td colSpan={5}>
        {q.isSuccess ? (
          <>
            <LigneFichier l={q.data} num={num} cible={cible} points={points}
              onCorrige={q.data.brut ? (col, v) => corriger.mutate({ [col]: v }) : undefined} enCours={corriger.isPending} />
            {corriger.isError && <p className="champ-erreur admin-erreur" role="alert">{corriger.error.message}</p>}
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
  /** Absent : ligne en lecture seule (lot analysé avant les corrections sur place). */
  onCorrige?: (colonne: string, valeur: string | null) => void
  enCours?: boolean
}

function LigneFichier({ l, num, cible, points, onCorrige, enCours }: LigneProps) {
  const [edition, setEdition] = useState<{ col: string; valeur: string } | null>(null)
  const choix = (n: string) => (n === 'MOIS' ? MOIS : l.choix?.[n])
  const ouvrir = (td: HTMLElement, n: string) => {
    // La cellule garde sa largeur pendant la saisie.
    td.style.minWidth = `${td.offsetWidth}px`
    ferme.current = false
    setEdition({ col: n, valeur: l.brut?.[n] ?? '' })
  }
  // Échap ou Entrée retire le champ, ce qui déclenche aussi sa perte de focus : une seule fermeture compte.
  const ferme = useRef(false)
  const fermer = (garder: boolean) => {
    if (!edition || ferme.current) return
    ferme.current = true
    const v = edition.valeur.trim()
    setEdition(null)
    if (garder && v !== (l.brut?.[edition.col] ?? '').trim()) onCorrige?.(edition.col, v || null)
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
    const minuterie = window.setTimeout(() => div.scrollTo({
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
            {cellules.map(([n, v], i) => {
              const p = parColonne.get(n)
              const classe = [p && (p.gravite === 'bloquant' ? 'cellule-ko' : 'cellule-attention'), n === cible && 'cellule-cible', i < FIGEES && 'fige']
                .filter(Boolean).join(' ')
              const modifiable = onCorrige != null && l.brut != null && n in l.brut && !enCours
              if (edition?.col === n) {
                const liste = choix(n)
                return (
                  <td key={n} className={[classe, 'en-saisie'].filter(Boolean).join(' ')} title={p?.message}>
                    <input autoFocus aria-label={`${n}, ligne ${num}`} value={edition.valeur} list={liste ? `choix-${num}-${i}` : undefined}
                      onChange={(e) => setEdition({ col: n, valeur: e.target.value })} onBlur={() => fermer(true)}
                      onKeyDown={(e) => { if (e.key === 'Enter') fermer(true); else if (e.key === 'Escape') fermer(false) }} />
                    {liste && <datalist id={`choix-${num}-${i}`}>{liste.map((c) => <option key={c} value={c} />)}</datalist>}
                  </td>
                )
              }
              return (
                <td key={n} className={[classe, modifiable && 'modifiable'].filter(Boolean).join(' ') || undefined} title={p?.message}
                  onClick={modifiable ? (e) => ouvrir(e.currentTarget, n) : undefined}>{v ?? p?.valeur ?? ''}</td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
