import { useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePilotage } from '../../api/pilotage'
import { urlModele, useDernierePeriode, usePreparation, type Lot } from '../../api/saisie'
import Etat, { etatErreur } from '../../components/Etat'
import { Bouton, Carte, ChoixFichier } from '../../components/Kit'
import { MOIS } from '../../lib/format'
import type { Ligne } from '../../lib/grille'
import ApercuLot from './saisie/ApercuLot'
import BarreParcours from './saisie/BarreParcours'
import CarteBudgets from './saisie/CarteBudgets'
import CarteCaMarge from './saisie/CarteCaMarge'
import SaisieBudgets from './saisie/SaisieBudgets'
import { cleBrouillon, effacerBrouillon, lireBrouillon, nouveauBrouillonId } from './saisie/brouillon'
import ChoixEmployes, { selectionDefaut } from './saisie/ChoixEmployes'
import type { Enregistrement } from './saisie/Enregistre'
import GrilleSaisie, { lignesSelection, ligneVide } from './saisie/GrilleSaisie'
import ImportFichier, { ACCEPT } from './saisie/ImportFichier'

type Etape =
  | { e: 'depart' }
  | { e: 'choix' }
  | { e: 'grille'; lignes: Ligne[]; brouillonId: string }
  | { e: 'fichier'; fichier: File }
  | { e: 'apercu'; lot: Lot; depuis: 'grille' | 'fichier' }
  | { e: 'budgets' }

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

  const prepa = usePreparation(annee, mois, etape.e === 'choix' || etape.e === 'grille')
  const pilotage = usePilotage(annee, mois, etape.e === 'depart' || etape.e === 'budgets')
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
            <select value={annee} onChange={(e) => setChoixPeriode([Number(e.target.value), mois])}>
              {annees.map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label>
            Mois
            <select value={mois} onChange={(e) => setChoixPeriode([annee, Number(e.target.value)])}>
              {MOIS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
          {derniere.data && (
            <span className="note">Dernier mois saisi : {MOIS[derniere.data.mois - 1]} {derniere.data.annee} ({derniere.data.lignes} lignes)</span>
          )}
        </div>
        <div className="saisie-cartes">
          <Carte titre="Saisir dans l’application">
            <p className="note">Cochez les employés concernés, puis tapez ou collez les montants dans une grille.</p>
            <div className="saisie-carte-action">
              {/* Mois figé : un rafraîchissement du « dernier mois saisi » ne doit plus le déplacer. */}
              <Bouton onClick={() => { setChoixPeriode([annee, mois]); setSelection(null); setBrouillon(lireBrouillon(cle)); setEtape({ e: 'choix' }) }}>
                Saisir les montants de {periode} →
              </Bouton>
            </div>
          </Carte>
          <Carte titre="Remplir un fichier Excel">
            <ol className="saisie-deux-temps">
              <li>
                <span>Téléchargez le modèle, déjà rempli avec les employés de {periode}.</span>
                <a className="bouton bouton-secondaire" href={urlModele(annee, mois)} download>
                  <Download aria-hidden="true" size={16} strokeWidth={2.25} /> Télécharger le modèle de {periode}
                </a>
              </li>
              <li>
                <span>Importez le fichier rempli : il peut couvrir plusieurs mois. Rien n’est enregistré avant l’aperçu.</span>
                <ChoixFichier libelle="Importer un fichier (.xlsx)" accept={ACCEPT} inputRef={fichierRef} onFichier={choisirFichier} />
              </li>
            </ol>
          </Carte>
        </div>
        <h3 className="saisie-sous-bandeau">PILOTAGE DE {periode.toUpperCase()}</h3>
        {pilotage.data ? (
          <div className="saisie-cartes">
            <CarteCaMarge key={periode} vue={pilotage.data} periode={periode} />
            <CarteBudgets vue={pilotage.data} periode={periode} onSaisir={() => { setChoixPeriode([annee, mois]); setEtape({ e: 'budgets' }) }} />
          </div>
        ) : (
          <Etat type={pilotage.isError ? etatErreur(pilotage.error) : 'chargement'} onRetry={() => pilotage.refetch()} />
        )}
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
        onValider={(mats) => {
          setSelection(mats)
          // Saisie en cours : on garde ce qui est déjà tapé, on ajoute les nouveaux cochés, on retire les décochés.
          const lignes = lignesSelection(p, mats, brouillon?.lignes)
          setEtape({
            e: 'grille',
            lignes: lignes.length ? lignes : [ligneVide(p.rubriques.map((r) => r.libelle))],
            brouillonId: brouillon?.id ?? nouveauBrouillonId(),
          })
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
      onRetour={() => { setBrouillon(lireBrouillon(cle)); setEtape({ e: 'choix' }) }}
      onLot={(lot) => {
        grille.current = { lignes: lireBrouillon(cle)?.lignes ?? etape.lignes, brouillonId: etape.brouillonId }
        surLot(lot)
      }}
    />
  )
}
