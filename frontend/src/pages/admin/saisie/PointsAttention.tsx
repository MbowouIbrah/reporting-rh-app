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
          <Tableau lignes={g.lignes} tous={anomalies} lotId={lotId} afficherLigne={afficherLigne} />
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
}

function Tableau({ lignes, tous, lotId, afficherLigne }: TableauProps) {
  const [deplie, setDeplie] = useState<number | null>(null)
  return (
    <table className="dense points">
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
          // Comme le détail par contrat du compte rendu : un clic n'importe où sur la ligne la déplie ou la replie.
          const clic = depliable ? () => setDeplie(ouvert ? null : i) : undefined
          const classe = depliable ? 'depliable' : undefined
          return (
            <Fragment key={i}>
              <tr className={classe} onClick={clic}>
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
                <td>{a.message}</td>
              </tr>
              {ouvert && (
                <DetailLigne lotId={lotId!} num={a.ligne!} cible={a.colonne} classe={classe!} clic={clic!}
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
  classe: string
  clic: () => void
}

/** Lignes ajoutées sous le point : une par colonne du fichier, cellules en cause surlignées (rouge à corriger, orange à confirmer). */
function DetailLigne({ lotId, num, cible, points, classe, clic }: DetailProps) {
  const q = useQuery({ queryKey: ['saisie', 'ligne', lotId, num], queryFn: () => lireLigne(lotId, num) })
  const libelle = `Détail de la ligne ${num} du fichier`
  if (!q.isSuccess) {
    return (
      <tr className={`${classe} detail-contrat`} onClick={clic}>
        <EnteteDetail libelle={libelle} lignes={1} />
        <td colSpan={3} className="retrait muted">{q.isPending ? 'Chargement…' : 'Contenu indisponible.'}</td>
      </tr>
    )
  }
  const l = q.data
  const parColonne = new Map(points.map((p) => [p.colonne, p]))
  const rubriques = [...new Set([...Object.keys(l.montants), ...points.map((p) => p.colonne ?? '')])]
    .filter((c) => c && !ATTRIBUTS.some(([n]) => n === c))
  const cellules: [string, string | null][] = [
    ...ATTRIBUTS.map(([n, f]): [string, string | null] => [n, f(l)]),
    ...rubriques.map((r): [string, string | null] => [r, l.montants[r] != null ? valeurBrute(l.montants[r]) : null]),
  ]
  return (
    <>
      {cellules.map(([n, v], i) => {
        const p = parColonne.get(n)
        const ton = p && (p.gravite === 'bloquant' ? 'cellule-ko' : 'cellule-attention')
        const valeur = [ton, n === cible && 'cellule-cible'].filter(Boolean).join(' ')
        return (
          <tr key={n} className={`${classe} detail-contrat`} onClick={clic}>
            {i === 0 && <EnteteDetail libelle={libelle} lignes={cellules.length} />}
            <td className="retrait">{n}</td>
            <td className={valeur || undefined}>{v ?? p?.valeur ?? ''}</td>
            <td className={ton || undefined}>{p?.message ?? ''}</td>
          </tr>
        )
      })}
    </>
  )
}

/** Comme le compte rendu : cellule qui couvre les colonnes Ligne et Employé sur toute la hauteur du détail. */
const EnteteDetail = ({ libelle, lignes }: { libelle: string; lignes: number }) => (
  <th scope="rowgroup" rowSpan={lignes} colSpan={2} className="service detail">
    <span className="detail-libelle">{libelle}</span>
  </th>
)
