import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { lireLigne, type AnomalieLot, type LigneLot } from '../../../api/saisie'
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
  /** Numéro de ligne du fichier : sans objet pour une saisie en grille. */
  afficherLigne: boolean
  /** Volet ouvert, partagé avec le reste de l'aperçu : un seul à la fois. */
  ouvert: string | null
  onOuvrir: (id: string) => void
}

/** Points regroupés par nature et par niveau (à corriger, à confirmer, corrigé automatiquement). */
export default function PointsAttention({ anomalies, lotId, afficherLigne, ouvert, onOuvrir }: Props) {
  return (
    <>
      {repartir(anomalies).map((g) => (
        <Volet key={g.id} titre={g.titre} valeur={g.lignes.length} ton={NIVEAUX[g.niveau].ton}
          resume={<><span className="volet-niveau">{NIVEAUX[g.niveau].libelle}</span> : {g.aide}</>}
          ouvert={ouvert === g.id} onOuvrir={() => onOuvrir(g.id)}>
          <Tableau lignes={g.lignes} tous={anomalies} lotId={lotId} afficherLigne={afficherLigne} ton={NIVEAUX[g.niveau].ton} />
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
  afficherLigne: boolean
  /** Couleur de la bordure du détail déplié : celle du niveau du volet. */
  ton?: 'ko' | 'attention'
}

function Tableau({ lignes, tous, lotId, afficherLigne, ton }: TableauProps) {
  const [deplie, setDeplie] = useState<number | null>(null)
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
          const ouvert = depliable && deplie === i
          return (
            <Fragment key={i}>
              <tr>
                {afficherLigne && (
                  <td className={ouvert ? 'num ouvert' : 'num'}>
                    {depliable ? (
                      <button type="button" className="deplier" aria-expanded={ouvert} aria-label={`Détail de la ligne ${a.ligne}`}
                        onClick={() => setDeplie(ouvert ? null : i)}>
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
                <DetailLigne lotId={lotId!} num={a.ligne!} cible={a.colonne}
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

interface DetailProps {
  lotId: number
  num: number
  cible: string | null
  points: AnomalieLot[]
}

/** Sous le point, comme le détail par contrat : la ligne du fichier (en-tête et valeurs), cellules en cause surlignées. */
function DetailLigne({ lotId, num, cible, points }: DetailProps) {
  const q = useQuery({ queryKey: ['saisie', 'ligne', lotId, num], queryFn: () => lireLigne(lotId, num) })
  return (
    <tr className="detail-contrat">
      <td colSpan={5}>
        {q.isSuccess ? <LigneFichier l={q.data} num={num} cible={cible} points={points} />
          : <span className="muted">{q.isPending ? 'Chargement…' : 'Contenu indisponible.'}</span>}
      </td>
    </tr>
  )
}

function LigneFichier({ l, num, cible, points }: { l: LigneLot; num: number; cible: string | null; points: AnomalieLot[] }) {
  const parColonne = new Map(points.map((p) => [p.colonne, p]))
  const rubriques = [...new Set([...Object.keys(l.montants), ...points.map((p) => p.colonne ?? '')])]
    .filter((c) => c && !ATTRIBUTS.some(([n]) => n === c))
  const cellules: [string, string | null][] = [
    ...ATTRIBUTS.map(([n, f]): [string, string | null] => [n, f(l)]),
    ...rubriques.map((r): [string, string | null] => [r, l.montants[r] != null ? valeurBrute(l.montants[r]) : null]),
  ]
  return (
    <div className="ligne-fichier">
      <table className="dense points" aria-label={`Ligne ${num} du fichier`}>
        <thead>
          <tr>{cellules.map(([n]) => <th key={n} scope="col">{n}</th>)}</tr>
        </thead>
        <tbody>
          <tr>
            {cellules.map(([n, v]) => {
              const p = parColonne.get(n)
              const classe = [p && (p.gravite === 'bloquant' ? 'cellule-ko' : 'cellule-attention'), n === cible && 'cellule-cible']
                .filter(Boolean).join(' ')
              return <td key={n} className={classe || undefined} title={p?.message}>{v ?? p?.valeur ?? ''}</td>
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
