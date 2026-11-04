import { useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePilotage, type Groupe } from '../../api/pilotage'
import { urlModele, useDernierePeriode, usePreparation, type Lot } from '../../api/saisie'
import Etat, { etatErreur } from '../../components/Etat'
import { Bouton, Carte, ChoixFichier, Confirmer } from '../../components/Kit'
import { MOIS } from '../../lib/format'
import type { Ligne } from '../../lib/grille'
import ApercuLot from './saisie/ApercuLot'
import BarreParcours from './saisie/BarreParcours'
import CartesMois from './saisie/CartesMois'
import SaisieBudgets from './saisie/SaisieBudgets'
import SaisieDonnees from './saisie/SaisieDonnees'
import { cleBrouillon, effacerBrouillon, lireBrouillon, nouveauBrouillonId } from './saisie/brouillon'
import ChoixEmployes, { selectionDefaut } from './saisie/ChoixEmployes'
import type { Enregistrement } from './saisie/Enregistre'
import GrilleSaisie, { lignesSelection } from './saisie/GrilleSaisie'
import ImportFichier, { ACCEPT } from './saisie/ImportFichier'

type Etape =
  | { e: 'depart' }
  | { e: 'choix' }
  | { e: 'grille'; lignes: Ligne[]; brouillonId: string }
  | { e: 'fichier'; fichier: File }
  | { e: 'apercu'; lot: Lot; depuis: 'grille' | 'fichier' }
  | { e: 'budgets' }
  | { e: 'donnees'; groupe?: Groupe }

const suivant = (a: number, m: number) => (m === 12 ? [a + 1, 1] : [a, m + 1])

export default function Saisie() {
  const qc = useQueryClient()
  const derniere = useDernierePeriode()
  const auj = new Date()
  const [choixPeriode, setChoixPeriode] = useState<[number, number] | null>(null)
  const propose: [number, number] = derniere.data
    ? (suivant(derniere.data.annee, derniere.data.mois) as [number, number])
    : [auj.getFullYear(), auj.getMonth() + 1]
  const [annee, mois] = choixPeriode ?? propose
  const [etape, setEtape] = useState<Etape>({ e: 'depart' })
  const [selection, setSelection] = useState<string[] | null>(null)
  const grille = useRef<{ lignes: Ligne[]; brouillonId: string } | null>(null)
  const navigate = useNavigate()
  const fichierRef = useRef<HTMLInputElement>(null)
  // Saisie non enregistrée dans la grille de données : toute action qui la quitterait demande confirmation.
  const [sale, setSale] = useState(false)
  const [enAttente, setEnAttente] = useState<{ action: () => void } | null>(null)
  const garde = (action: () => void) => (sale ? setEnAttente({ action }) : action())

  const prepa = usePreparation(annee, mois, etape.e === 'choix' || etape.e === 'grille')
  // Mois 0 : plusieurs mois dans un même fichier, chaque ligne porte son année et son mois.
  const plusieurs = mois === 0
  const pilotage = usePilotage(annee, mois, !plusieurs && (etape.e === 'depart' || etape.e === 'budgets'))
  const periode = `${MOIS[mois - 1]} ${annee}`
  const cle = cleBrouillon(annee, mois)
  const [brouillon, setBrouillon] = useState(() => lireBrouillon(cle))

  const surLot = useCallback((lot: Lot) => setEtape((et) => ({ e: 'apercu', lot, depuis: et.e === 'fichier' ? 'fichier' : 'grille' })), [])
  const choisirFichier = (f: File | undefined) => f && setEtape({ e: 'fichier', fichier: f })
  // Enregistré : retour sur la feuille DONNEES, qui confirme et propose d'annuler.
  const fini = (lot: Lot, enregistrees: number) => {
    if (etape.e === 'apercu' && etape.depuis === 'grille') effacerBrouillon(cle)
    grille.current = null
    qc.invalidateQueries({ queryKey: ['donnees'] })
    qc.invalidateQueries({ queryKey: ['saisie'] })
    const enregistrement: Enregistrement = { lot: lot.id, fichier: lot.fichier_nom, lignes: enregistrees }
    navigate('/admin', { state: { enregistrement } })
  }

  if (etape.e === 'depart') {
    const annees = Array.from({ length: 5 }, (_, i) => auj.getFullYear() - 3 + i)
    return (
      <section className="page-ecran rapport-excel saisie-depart">
        <BarreParcours libelle="Administration" vers="/admin" />
        <h2 className="bandeau-titre">RENSEIGNER DES DONNÉES</h2>
        <div className="filtres saisie-periode" role="group" aria-label="Période à renseigner">
          <label>
            Année
            <select value={annee} disabled={plusieurs} onChange={(e) => garde(() => setChoixPeriode([Number(e.target.value), mois]))}>
              {annees.map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label>
            Mois
            <select value={mois} onChange={(e) => garde(() => setChoixPeriode([annee, Number(e.target.value)]))}>
              {MOIS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              <option value={0}>Plusieurs mois</option>
            </select>
          </label>
          {derniere.data && (
            <span className="note">Dernier mois saisi : {MOIS[derniere.data.mois - 1]} {derniere.data.annee} ({derniere.data.lignes} lignes)</span>
          )}
        </div>
        <div className="saisie-cartes saisie-cartes-depart">
          <Carte titre="Saisir dans l’application">
            <ol className="saisie-deux-temps">
              <li><span>Choisissez les employés : décochez les départs, ajoutez les arrivées (« Nouvel employé »).</span></li>
              <li><span>Tapez ou collez les montants dans la grille.</span></li>
              <li><span>Vérifiez l’aperçu, puis enregistrez.</span></li>
            </ol>
            <div className="saisie-carte-action">
              {plusieurs ? (
                <p className="note">Choisissez un mois précis pour saisir dans l’application.</p>
              ) : (
                /* Mois figé : un rafraîchissement du « dernier mois saisi » ne doit plus le déplacer. */
                <Bouton onClick={() => garde(() => { setChoixPeriode([annee, mois]); setSelection(null); setBrouillon(lireBrouillon(cle)); setEtape({ e: 'choix' }) })}>
                  Étape 1 : choisir les employés de {periode} →
                </Bouton>
              )}
            </div>
          </Carte>
          <Carte titre="Remplir un fichier Excel">
            <ol className="saisie-deux-temps">
              <li><span>Téléchargez le modèle vide (sans la liste des employés).</span></li>
              <li>
                <span>
                  {plusieurs
                    ? 'Remplissez-le dans Excel : une ligne par employé et par mois.'
                    : `Remplissez-le dans Excel : une ligne par employé de ${periode}.`}
                </span>
              </li>
              <li><span>Importez le fichier rempli. Rien n’est enregistré avant l’aperçu.</span></li>
            </ol>
            <div className="saisie-carte-action">
              <a className="bouton bouton-secondaire" href={plusieurs ? urlModele() : urlModele(annee, mois)} download>
                <Download aria-hidden="true" size={16} strokeWidth={2.25} /> Télécharger le modèle vide
              </a>
              <ChoixFichier libelle="Importer un fichier (.xlsx)" variante="primaire" accept={ACCEPT} inputRef={fichierRef} onFichier={(f) => garde(() => choisirFichier(f))} />
            </div>
          </Carte>
        </div>
        <h3 className="saisie-sous-bandeau">{plusieurs ? 'DONNÉES DU MOIS' : `DONNÉES DE ${periode.toUpperCase()}`}</h3>
        {/* CA, marge, activité et budgets se rattachent à un seul mois : chaque carte ouvre sa page ; plusieurs mois, la raison remplace les cartes. */}
        {plusieurs ? (
          <p className="note">Choisissez un mois précis pour saisir le CA, la marge, l’activité, les objectifs et les budgets.</p>
        ) : (
          <CartesMois
            annee={annee}
            mois={mois}
            periode={periode}
            onBudgets={() => { setChoixPeriode([annee, mois]); setEtape({ e: 'budgets' }) }}
            onDonnees={(groupe) => { setChoixPeriode([annee, mois]); setEtape({ e: 'donnees', groupe }) }}
          />
        )}
      </section>
    )
  }

  if (etape.e === 'donnees') {
    return (
      <section className="page-ecran rapport-excel saisie-donnees-page">
        <BarreParcours libelle="Choix du mois" onRetour={() => garde(() => { setSale(false); setEtape({ e: 'depart' }) })} />
        <h2 className="bandeau-titre">DONNÉES — {periode.toUpperCase()}</h2>
        <SaisieDonnees key={periode} annee={annee} mois={mois} periode={periode} onModifs={setSale} garde={garde} ongletInitial={etape.groupe} />
        <Confirmer
          ouvert={enAttente !== null}
          titre="Quitter sans enregistrer ?"
          confirmer="Quitter sans enregistrer"
          onConfirmer={() => {
            const a = enAttente
            setEnAttente(null)
            a?.action()
          }}
          onAnnuler={() => setEnAttente(null)}
        >
          <p>Les chiffres tapés dans la grille et non enregistrés seront perdus.</p>
        </Confirmer>
      </section>
    )
  }

  if (etape.e === 'budgets') {
    if (!pilotage.data) return <Etat type={pilotage.isError ? etatErreur(pilotage.error) : 'chargement'} onRetry={() => pilotage.refetch()} />
    return <SaisieBudgets key={periode} vue={pilotage.data} periode={periode} onRetour={() => setEtape({ e: 'depart' })} />
  }

  if (etape.e === 'fichier') {
    return <ImportFichier fichier={etape.fichier} onLot={surLot} onAutre={choisirFichier} onRetour={() => setEtape({ e: 'depart' })} />
  }

  if (etape.e === 'apercu') {
    const retour = () => (etape.depuis === 'grille' && grille.current ? setEtape({ e: 'grille', ...grille.current }) : setEtape({ e: 'depart' }))
    return <ApercuLot lot={etape.lot} parcours={etape.depuis} onRetour={retour} onFini={fini} />
  }

  if (prepa.isLoading) return <Etat type="chargement" />
  if (prepa.isError || !prepa.data) return <Etat type={etatErreur(prepa.error)} onRetry={() => prepa.refetch()} />
  const p = prepa.data

  if (etape.e === 'choix') {
    return (
      <ChoixEmployes
        prepa={p}
        selection={selection ?? (brouillon ? brouillon.lignes.filter((l) => l._connu).map((l) => l.matricule) : selectionDefaut(p))}
        brouillon={brouillon}
        onRetour={() => setEtape({ e: 'depart' })}
        onReprendre={() => brouillon && setEtape({ e: 'grille', lignes: brouillon.lignes, brouillonId: brouillon.id })}
        onOublier={() => { effacerBrouillon(cle); setBrouillon(null) }}
        onImporter={choisirFichier}
        onValider={(mats, nouveaux) => {
          setSelection(mats)
          // Saisie en cours : on garde ce qui est déjà tapé, on ajoute les cochés et les nouveaux employés, on retire les décochés.
          const enCours = [...(brouillon?.lignes.filter((l) => l._connu) ?? []), ...nouveaux]
          setEtape({ e: 'grille', lignes: lignesSelection(p, mats, enCours), brouillonId: brouillon?.id ?? nouveauBrouillonId() })
        }}
      />
    )
  }

  return (
    <GrilleSaisie
      key={etape.brouillonId}
      prepa={p}
      lignesInitiales={etape.lignes}
      brouillonId={etape.brouillonId}
      onImporter={choisirFichier}
      onRetour={() => { setBrouillon(lireBrouillon(cle)); setEtape({ e: 'choix' }) }}
      onLot={(lot) => {
        grille.current = { lignes: lireBrouillon(cle)?.lignes ?? etape.lignes, brouillonId: etape.brouillonId }
        surLot(lot)
      }}
    />
  )
}
