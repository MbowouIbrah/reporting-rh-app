import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { lireAnomalies, lireApercu, validerLot, type Cle, type LigneApercu, type Lot } from '../../../api/saisie'
import { queryRetry } from '../../../api/client'
import Etat, { etatErreur } from '../../../components/Etat'
import { Badge, Bouton } from '../../../components/Kit'
import { matriculeAffiche, MOIS, valeurBrute } from '../../../lib/format'
import BarreParcours from './BarreParcours'
import Etapes from './Etapes'
import PointsAttention, { VOLET_ERREURS } from './PointsAttention'
import Volet from './Volet'

const cle = (l: LigneApercu) => `${l.annee}-${l.mois}-${l.matricule}`
const periode = (l: { annee: number; mois: number }) => `${MOIS[l.mois - 1]} ${l.annee}`
const s = (n: number) => (n > 1 ? 's' : '')
const val = (v: string | null) => (v === null ? '(vide)' : /^-?\d/.test(v) ? valeurBrute(v) : v)

interface Props {
  lot: Lot
  parcours: 'grille' | 'fichier'
  onRetour: () => void
  onFini: (lot: Lot, enregistrees: number) => void
}

/** Ce que l'enregistrement va changer ; pour chaque ligne déjà présente, l'utilisateur choisit de remplacer ou garder. */
export default function ApercuLot({ lot: recu, parcours, onRetour, onFini }: Props) {
  // Une correction sur place relance les contrôles : compteurs et statut suivent le lot renvoyé.
  const [lot, setLot] = useState(recu)
  const q = useQuery({ queryKey: ['saisie', 'apercu', lot.id], queryFn: () => lireApercu(lot.id), retry: queryRetry })
  const anomalies = useQuery({
    queryKey: ['saisie', 'anomalies', lot.id],
    queryFn: () => lireAnomalies(lot.id),
    enabled: lot.nb_avert + lot.nb_bloquants > 0,
    retry: queryRetry,
  })
  const [gardees, setGardees] = useState<Set<string>>(new Set())
  const [envoi, setEnvoi] = useState<{ cours: boolean; erreur?: string }>({ cours: false })
  // Volet ouvert : le plus prioritaire tant que l'utilisateur n'en a pas choisi un autre.
  const [choixVolet, setChoixVolet] = useState<string>()
  const volets = useRef<HTMLDivElement>(null)
  // Volet déplié par l'utilisateur : amené en haut de la liste des volets, qui défile seule.
  useEffect(() => {
    if (choixVolet === undefined) return
    const doux = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const cadre = volets.current
    const v = cadre?.querySelector('.volet-ouvert')
    if (!cadre || !v) return
    const comportement = doux ? 'smooth' : 'auto'
    // Grand écran : seule la liste des volets défile, la page ne bouge pas.
    if (cadre.scrollHeight > cadre.clientHeight)
      cadre.scrollTo?.({ top: cadre.scrollTop + v.getBoundingClientRect().top - cadre.getBoundingClientRect().top - 12, behavior: comportement })
    else v.scrollIntoView?.({ block: 'start', behavior: comportement })
  }, [choixVolet])
  const [enAttente, setEnAttente] = useState(0)
  const [pied, setPied] = useState<HTMLElement | null>(null)
  const d = q.data

  if (q.isLoading) return <Etat type="chargement" />
  if (q.isError || !d) return <Etat type={etatErreur(q.error)} onRetry={() => q.refetch()} />

  const modifiees = d.lignes.filter((l) => l.statut === 'modifiee')
  const nouvelles = d.lignes.filter((l) => l.statut === 'nouvelle')
  const ouvert = choixVolet !== undefined ? choixVolet
    : d.nb_absents > 0 ? 'absents'
    : lot.nb_bloquants > 0 ? VOLET_ERREURS
    : modifiees.length > 0 ? 'modifiees'
    : nouvelles.length > 0 ? 'nouvelles' : null
  // Effectif du dernier mois couvert : employés distincts ayant une ligne ce mois-là.
  const dernier = d.lignes.reduce<{ annee: number; mois: number } | undefined>(
    (m, l) => (!m || l.annee * 12 + l.mois > m.annee * 12 + m.mois ? l : m), undefined)
  const effectif = dernier && new Set(d.lignes.filter((l) => l.annee === dernier.annee && l.mois === dernier.mois).map((l) => l.matricule)).size
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
    <section className="page-ecran rapport-excel saisie-apercu saisie-verif">
      <BarreParcours libelle={parcours === 'grille' ? 'Saisie des montants' : 'Choix du fichier'} onRetour={onRetour} desactive={envoi.cours}>
        <Etapes parcours={parcours} actuelle={parcours === 'grille' ? 3 : 1} />
      </BarreParcours>
      <h2 className="bandeau-titre">VÉRIFICATION AVANT ENREGISTREMENT{objet && ` — ${objet}`}</h2>
      <div className="saisie-synthese" role="status">
        <section aria-label="Lignes" className="saisie-carte-chiffre">
          <h3>Lignes ({d.lignes.length})</h3>
          <ul>
            <li><Badge ton="succes">{d.nouvelle}</Badge> à ajouter (pas encore enregistrée{s(d.nouvelle)})</li>
            <li><Badge ton="alerte">{d.modifiee}</Badge> à mettre à jour (déjà enregistrée{s(d.modifiee)}, montants différents)</li>
            <li><Badge>{d.identique}</Badge> déjà enregistrée{s(d.identique)} à l’identique (ignorée{s(d.identique)})</li>
          </ul>
          <p className="saisie-chiffre"><span>Total des charges : <strong>{valeurBrute(d.total_lot)}</strong> FCFA</span></p>
        </section>
        <section aria-label="Employés" className="saisie-carte-chiffre">
          <h3>Employés ({d.employes.total})</h3>
          <ul>
            <li><Badge>{d.employes.existants}</Badge> déjà connu{s(d.employes.existants)}</li>
            <li><Badge ton={d.employes.nouveaux ? 'info' : 'neutre'}>{d.employes.nouveaux}</Badge> nouvel{s(d.employes.nouveaux)} employé{s(d.employes.nouveaux)} (à créer)</li>
            <li><Badge ton={d.nb_absents ? 'erreur' : 'neutre'}>{d.nb_absents}</Badge> <span className="saisie-oubli">oubli{s(d.nb_absents)}</span> ou départ{s(d.nb_absents)} (présent{s(d.nb_absents)} le mois précédent, sans ligne ici)</li>
          </ul>
          {dernier && <p className="saisie-chiffre"><span>Effectif {periode(dernier)} : <strong>{effectif}</strong></span></p>}
        </section>
        <section aria-label="Contrôles">
          <h3>Contrôles</h3>
          <ul>
            <li><Badge ton={lot.nb_bloquants ? 'erreur' : 'succes'}>{lot.nb_bloquants}</Badge> erreur{s(lot.nb_bloquants)} bloquante{s(lot.nb_bloquants)}</li>
            <li><Badge ton={lot.nb_avert ? 'alerte' : 'succes'}>{lot.nb_avert}</Badge> point{s(lot.nb_avert)} d’attention</li>
            <li><Badge ton={d.effaces ? 'erreur' : 'neutre'}>{d.effaces}</Badge> montant{s(d.effaces)} enregistré{s(d.effaces)} vidé{s(d.effaces)} en cas de remplacement</li>
          </ul>
        </section>
      </div>
      {d.effaces > 0 && (
        <p className="bandeau ko" role="alert">
          {d.effaces} montant{s(d.effaces)} existant{s(d.effaces)} {d.effaces > 1 ? 'seront' : 'sera'} effacé{s(d.effaces)} (cellule vide dans la saisie) si vous remplacez la ligne.
        </p>
      )}
      <div className="panneau">
        <div ref={volets} className="panneau-corps volets" role="region" aria-label="Détail de l'aperçu">
          {d.nb_absents > 0 && (
            <Volet titre={<><span className="saisie-oubli">Oublis</span> ou départs</>} valeur={d.nb_absents} ton="ko"
              resume="présents le mois précédent, sans ligne ici : à ajouter si oubli, sinon départ"
              ouvert={ouvert === 'absents'} onOuvrir={() => setChoixVolet('absents')}>
              <table className="dense">
                <thead><tr><th scope="col">Matricule</th><th scope="col">Nom</th><th scope="col">Mois</th></tr></thead>
                <tbody>
                  {d.absents.map((a) => (
                    <tr key={`${a.annee}-${a.mois}-${a.matricule}`}><td>{matriculeAffiche(a.matricule) || "—"}</td><td>{a.nom}</td><td>{periode(a)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Volet>
          )}
          {modifiees.length > 0 && (
            <Volet titre="Lignes à mettre à jour" valeur={modifiees.length} resume="remplacer par la saisie ou garder l’existant ?"
              ouvert={ouvert === 'modifiees'} onOuvrir={() => setChoixVolet('modifiees')}>
              <p className="saisie-tout">
                <button type="button" className="bouton bouton-lien" onClick={() => setGardees(new Set())}>Tout remplacer</button>
                <button type="button" className="bouton bouton-lien" onClick={() => setGardees(new Set(modifiees.map(cle)))}>Tout garder</button>
              </p>
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
            </Volet>
          )}
          {nouvelles.length > 0 && (
            <Volet titre="Lignes à ajouter" valeur={nouvelles.length} ton="ok" resume="pas encore enregistrées"
              ouvert={ouvert === 'nouvelles'} onOuvrir={() => setChoixVolet('nouvelles')}>
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
            </Volet>
          )}
          {d.nouveaux_salaries.length > 0 && (
            <Volet titre="Nouveaux employés" valeur={d.nouveaux_salaries.length} resume="absents de la base : créés à l’enregistrement"
              ouvert={ouvert === 'salaries'} onOuvrir={() => setChoixVolet('salaries')}>
              <table className="dense">
                <thead><tr><th scope="col">Matricule</th><th scope="col">Nom</th></tr></thead>
                <tbody>
                  {d.nouveaux_salaries.map((m) => (
                    <tr key={m}><td>{matriculeAffiche(m) || "—"}</td><td>{d.lignes.find((l) => l.matricule === m)?.nom}</td></tr>
                  ))}
                </tbody>
              </table>
            </Volet>
          )}
          {anomalies.data && <PointsAttention anomalies={anomalies.data} lotId={lot.id} onLot={setLot} onAttente={setEnAttente} afficherLigne={parcours === 'fichier'} lectureSeule ouvert={ouvert} onOuvrir={setChoixVolet} pied={pied} />}
        </div>
      </div>
      <div className="saisie-pied">
        {envoi.erreur && <span className="champ-erreur" role="alert">{envoi.erreur}</span>}
        {enAttente > 0 && <span className="muted">Enregistrez ou annulez d’abord les corrections.</span>}
        <span ref={setPied} className="pied-actions" />
        <Bouton variante="secondaire" onClick={onRetour} disabled={envoi.cours}>Revenir à l’étape précédente</Bouton>
        <Bouton onClick={enregistrer} disabled={envoi.cours || enAttente > 0}>
          {aEcrire > 0 ? `Enregistrer ${aEcrire} ligne${aEcrire > 1 ? 's' : ''}` : 'Terminer sans rien changer'}
        </Bouton>
      </div>
    </section>
  )
}
