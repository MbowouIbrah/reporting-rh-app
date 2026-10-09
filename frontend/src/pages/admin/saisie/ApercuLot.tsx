import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { lireAnomalies, lireApercu, validerLot, type Cle, type LigneApercu, type Lot } from '../../../api/saisie'
import { queryRetry } from '../../../api/client'
import Etat, { etatErreur } from '../../../components/Etat'
import { Badge, Bouton } from '../../../components/Kit'
import { matriculeAffiche, MOIS, valeurBrute } from '../../../lib/format'
import BarreParcours from './BarreParcours'
import Etapes from './Etapes'
import PointsAttention from './PointsAttention'

const cle = (l: LigneApercu) => `${l.annee}-${l.mois}-${l.matricule}`
const periode = (l: { annee: number; mois: number }) => `${MOIS[l.mois - 1]} ${l.annee}`
const val = (v: string | null) => (v === null ? '(vide)' : /^-?\d/.test(v) ? valeurBrute(v) : v)

interface Props {
  lot: Lot
  parcours: 'grille' | 'fichier'
  onRetour: () => void
  onFini: (lot: Lot, enregistrees: number) => void
}

/** Ce que l'enregistrement va changer ; pour chaque ligne déjà présente, l'utilisateur choisit de remplacer ou garder. */
export default function ApercuLot({ lot, parcours, onRetour, onFini }: Props) {
  const q = useQuery({ queryKey: ['saisie', 'apercu', lot.id], queryFn: () => lireApercu(lot.id), retry: queryRetry })
  const anomalies = useQuery({
    queryKey: ['saisie', 'anomalies', lot.id],
    queryFn: () => lireAnomalies(lot.id),
    enabled: lot.nb_avert + lot.nb_bloquants > 0,
    retry: queryRetry,
  })
  const [gardees, setGardees] = useState<Set<string>>(new Set())
  const [envoi, setEnvoi] = useState<{ cours: boolean; erreur?: string }>({ cours: false })
  const d = q.data

  if (q.isLoading) return <Etat type="chargement" />
  if (q.isError || !d) return <Etat type={etatErreur(q.error)} onRetry={() => q.refetch()} />

  const modifiees = d.lignes.filter((l) => l.statut === 'modifiee')
  const nouvelles = d.lignes.filter((l) => l.statut === 'nouvelle')
  const aEcrire = nouvelles.length + modifiees.length - gardees.size
  const choisir = (k: string, garder: boolean) =>
    setGardees((g) => {
      const n = new Set(g)
      if (garder) n.add(k)
      else n.delete(k)
      return n
    })

  const enregistrer = async () => {
    setEnvoi({ cours: true })
    const garder: Cle[] = modifiees.filter((l) => gardees.has(cle(l))).map(({ annee, mois, matricule }) => ({ annee, mois, matricule }))
    try {
      const fini = await validerLot(lot.id, garder)
      onFini(fini, aEcrire)
    } catch (e) {
      setEnvoi({ cours: false, erreur: e instanceof Error ? e.message : 'Enregistrement impossible.' })
    }
  }

  // Ce qui est vérifié : le fichier importé, ou le mois saisi dans la grille.
  const objet = parcours === 'fichier' ? lot.fichier_nom : [...new Set(d.lignes.map(periode))].join(', ').toUpperCase()

  return (
    <section className="page-ecran rapport-excel saisie-apercu">
      <BarreParcours libelle={parcours === 'grille' ? 'Saisie des montants' : 'Choix du fichier'} onRetour={onRetour} desactive={envoi.cours}>
        <Etapes parcours={parcours} actuelle={parcours === 'grille' ? 3 : 1} />
      </BarreParcours>
      <h2 className="bandeau-titre">VÉRIFICATION AVANT ENREGISTREMENT{objet && ` — ${objet}`}</h2>
      <div className="saisie-synthese" role="status">
        <section aria-label="Lignes">
          <h3>Lignes ({d.lignes.length})</h3>
          <ul>
            <li><Badge ton="succes">{d.nouvelle}</Badge> nouvelle{d.nouvelle > 1 ? 's' : ''}</li>
            <li><Badge ton="alerte">{d.modifiee}</Badge> déjà présente{d.modifiee > 1 ? 's' : ''}, différente{d.modifiee > 1 ? 's' : ''}</li>
            <li><Badge>{d.identique}</Badge> identique{d.identique > 1 ? 's' : ''} (rien ne change)</li>
            <li>Total des charges : <strong>{valeurBrute(d.total_lot)}</strong> FCFA</li>
          </ul>
        </section>
        <section aria-label="Employés">
          <h3>Employés ({d.employes.total})</h3>
          <ul>
            <li><Badge>{d.employes.existants}</Badge> déjà connu{d.employes.existants > 1 ? 's' : ''}</li>
            <li><Badge ton={d.employes.nouveaux ? 'info' : 'neutre'}>{d.employes.nouveaux}</Badge> nouvel{d.employes.nouveaux > 1 ? 's' : ''} employé{d.employes.nouveaux > 1 ? 's' : ''}</li>
            <li><Badge ton={d.nb_absents ? 'alerte' : 'neutre'}>{d.nb_absents}</Badge> présent{d.nb_absents > 1 ? 's' : ''} le mois précédent, absent{d.nb_absents > 1 ? 's' : ''} ici</li>
          </ul>
        </section>
        <section aria-label="Contrôles">
          <h3>Contrôles</h3>
          <ul>
            <li><Badge ton={lot.nb_bloquants ? 'erreur' : 'succes'}>{lot.nb_bloquants}</Badge> erreur{lot.nb_bloquants > 1 ? 's' : ''}</li>
            <li><Badge ton={lot.nb_avert ? 'alerte' : 'succes'}>{lot.nb_avert}</Badge> point{lot.nb_avert > 1 ? 's' : ''} d’attention</li>
            <li><Badge ton={d.effaces ? 'erreur' : 'neutre'}>{d.effaces}</Badge> montant{d.effaces > 1 ? 's' : ''} effacé{d.effaces > 1 ? 's' : ''} si remplacement</li>
          </ul>
        </section>
      </div>
      {d.effaces > 0 && (
        <p className="bandeau ko" role="alert">
          {d.effaces} montant{d.effaces > 1 ? 's' : ''} existant{d.effaces > 1 ? 's' : ''} {d.effaces > 1 ? 'seront' : 'sera'} effacé{d.effaces > 1 ? 's' : ''} (cellule vide dans la saisie) si vous remplacez la ligne.
        </p>
      )}
      <div className="panneau">
        <div className="panneau-corps" role="region" aria-label="Détail de l'aperçu">
          {modifiees.length > 0 && (
            <>
              <h3 className="saisie-sous-titre">
                Lignes déjà présentes : remplacer par la saisie ou garder l’existant ?
                <span className="saisie-tout">
                  <button type="button" className="bouton bouton-lien" onClick={() => setGardees(new Set())}>Tout remplacer</button>
                  <button type="button" className="bouton bouton-lien" onClick={() => setGardees(new Set(modifiees.map(cle)))}>Tout garder</button>
                </span>
              </h3>
              <table className="dense">
                <thead>
                  <tr>
                    <th scope="col">Choix</th>
                    <th scope="col">Employé</th>
                    <th scope="col">Mois</th>
                    <th scope="col">Changements (avant → après)</th>
                    <th scope="col" className="num">Total avant</th>
                    <th scope="col" className="num">Total après</th>
                  </tr>
                </thead>
                <tbody>
                  {modifiees.map((l) => {
                    const k = cle(l)
                    const garde = gardees.has(k)
                    return (
                      <tr key={k} className={garde ? 'gardee' : undefined}>
                        <td>
                          <fieldset className="saisie-choix-ligne">
                            <legend className="sr-only">{l.nom ?? (matriculeAffiche(l.matricule) || "employé")}, {periode(l)}</legend>
                            <label><input type="radio" name={k} checked={!garde} onChange={() => choisir(k, false)} /> Remplacer</label>
                            <label><input type="radio" name={k} checked={garde} onChange={() => choisir(k, true)} /> Garder</label>
                          </fieldset>
                        </td>
                        <th scope="row">{l.nom} <span className="note">{matriculeAffiche(l.matricule)}</span></th>
                        <td>{periode(l)}</td>
                        <td>
                          <ul className="saisie-changements">
                            {l.changements.map((c) => (
                              <li key={c.colonne} className={c.apres === null ? 'efface' : undefined}>
                                <strong>{c.colonne}</strong> : {val(c.avant)} → {val(c.apres)}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className="num">{l.total_avant && valeurBrute(l.total_avant)}</td>
                        <td className="num">{valeurBrute(l.total_apres)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
          {nouvelles.length > 0 && (
            <details className="section" open={modifiees.length === 0}>
              <summary><span className="section-titre">Lignes nouvelles ({nouvelles.length})</span></summary>
              <table className="dense">
                <thead>
                  <tr><th scope="col">Employé</th><th scope="col">Mois</th><th scope="col" className="num">Total</th></tr>
                </thead>
                <tbody>
                  {nouvelles.map((l) => (
                    <tr key={cle(l)}>
                      <th scope="row">{l.nom} <span className="note">{matriculeAffiche(l.matricule)}</span>{l.nouveau_salarie && <Badge ton="info">Nouvel employé</Badge>}</th>
                      <td>{periode(l)}</td>
                      <td className="num">{valeurBrute(l.total_apres)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {d.nouveaux_salaries.length > 0 && (
            <details className="section">
              <summary>
                <span className="section-titre">Nouveaux employés ({d.nouveaux_salaries.length})</span>
                <span className="note">absents de la base : ils seront créés à l’enregistrement</span>
              </summary>
              <table className="dense">
                <thead><tr><th scope="col">Matricule</th><th scope="col">Nom</th></tr></thead>
                <tbody>
                  {d.nouveaux_salaries.map((m) => (
                    <tr key={m}><td>{matriculeAffiche(m) || "—"}</td><td>{d.lignes.find((l) => l.matricule === m)?.nom}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {d.nb_absents > 0 && (
            <details className="section">
              <summary>
                <span className="section-titre">Absents de cette saisie ({d.nb_absents})</span>
                <span className="note">présents le mois précédent : départ, ou oubli ?</span>
              </summary>
              <table className="dense">
                <thead><tr><th scope="col">Matricule</th><th scope="col">Nom</th><th scope="col">Mois</th></tr></thead>
                <tbody>
                  {d.absents.map((a) => (
                    <tr key={`${a.annee}-${a.mois}-${a.matricule}`}><td>{matriculeAffiche(a.matricule) || "—"}</td><td>{a.nom}</td><td>{periode(a)}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {anomalies.data && <PointsAttention anomalies={anomalies.data} afficherLigne={parcours === 'fichier'} />}
        </div>
      </div>
      <div className="saisie-pied">
        {envoi.erreur && <span className="champ-erreur" role="alert">{envoi.erreur}</span>}
        <Bouton onClick={enregistrer} disabled={envoi.cours}>
          {aEcrire > 0 ? `Enregistrer ${aEcrire} ligne${aEcrire > 1 ? 's' : ''}` : 'Terminer sans rien changer'}
        </Bouton>
      </div>
    </section>
  )
}
