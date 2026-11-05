import { useState, type FormEvent } from 'react'
import { useActiverColonne, useCreerColonne, useRemplissage, type ColonneRemplie } from '../../api/admin'
import { Panneau } from '../../components/BlocsRapport'
import Etat, { etatErreur } from '../../components/Etat'
import { Badge, Bouton, Champ, Confirmer } from '../../components/Kit'
import { MOIS } from '../../lib/format'

const NATURES = { paie: 'Paie', activite: 'Activité' } as const
type Nature = keyof typeof NATURES
const UNITES: Record<Nature, string[]> = { paie: ['FCFA', 'jours'], activite: ['nombre', 'FCFA', 'jours'] }
const COLONNES = ['Libellé', 'Nature', 'Unité', 'Valeurs', 'Dernier mois', 'État', 'Actions']
const nb = (n: number) => `${n.toLocaleString('fr-FR')} valeur${n > 1 ? 's' : ''}`

/** Colonnes des fichiers d'import (rubriques) : remplissage sur l'année, ajout, désactivation.
 *  L'ordre et le hachuré se règlent dans DONNEES (glisser les en-têtes). */
export default function Colonnes() {
  const [annee, setAnnee] = useState<number | null>(null)
  const q = useRemplissage(annee)
  const creer = useCreerColonne()
  const activer = useActiverColonne()
  const [libelle, setLibelle] = useState('')
  const [nature, setNature] = useState<Nature>('paie')
  const [unite, setUnite] = useState('FCFA')
  const [erreurLibelle, setErreurLibelle] = useState<string | null>(null)
  const [erreurAjout, setErreurAjout] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [aDesactiver, setADesactiver] = useState<ColonneRemplie | null>(null)

  const ajouter = (e: FormEvent) => {
    e.preventDefault()
    setErreurAjout(null)
    if (!libelle.trim()) return setErreurLibelle('Libellé obligatoire')
    setErreurLibelle(null)
    creer.mutate({ libelle: libelle.trim(), nature, unite }, { onSuccess: () => setLibelle(''), onError: (x) => setErreurAjout(x.message) })
  }
  const changer = (c: ColonneRemplie, actif: boolean) => {
    setErreur(null)
    activer.mutate(
      { id: c.id, actif },
      {
        onSuccess: () => setADesactiver(null),
        onError: (x) => {
          setADesactiver(null)
          setErreur(x.message)
        },
      },
    )
  }
  // Une colonne remplie disparaît des tableaux : on confirme, avec le nombre de valeurs touchées.
  const basculer = (c: ColonneRemplie) => (c.actif && c.valeurs > 0 ? setADesactiver(c) : changer(c, !c.actif))

  if (q.isLoading) return <Etat type="chargement" colonnes={COLONNES} lignes={6} />
  if (q.isError) return <Etat type={etatErreur(q.error)} onRetry={() => q.refetch()} />
  const d = q.data
  if (!d) return null
  const annees = d.annees.includes(d.annee) ? d.annees : [d.annee, ...d.annees]

  return (
    <Panneau titre="Colonnes" className="ref-colonnes">
      <form className="admin-form" aria-label="Ajouter une colonne" onSubmit={ajouter} noValidate>
        <Champ label="Nouvelle colonne" erreur={erreurLibelle}>
          {(p) => <input {...p} value={libelle} onChange={(e) => setLibelle(e.target.value)} />}
        </Champ>
        <Champ label="Nature">
          {(p) => (
            <select
              {...p}
              value={nature}
              onChange={(e) => {
                const n = e.target.value as Nature
                setNature(n)
                setUnite(UNITES[n][0])
              }}
            >
              {Object.entries(NATURES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
        </Champ>
        <Champ label="Unité">
          {(p) => (
            <select {...p} value={unite} onChange={(e) => setUnite(e.target.value)}>
              {UNITES[nature].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          )}
        </Champ>
        <div className="admin-actions en-ligne">
          <button type="submit" className="bouton bouton-primaire" disabled={creer.isPending}>Ajouter</button>
        </div>
        {erreurAjout && <p className="champ-erreur admin-erreur" role="alert">{erreurAjout}</p>}
      </form>
      <div className="ref-colonnes-tete">
        <Champ label="Remplissage en">
          {(p) => (
            <select {...p} value={d.annee} onChange={(e) => setAnnee(Number(e.target.value))}>
              {annees.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
        </Champ>
        <p className="note">Une colonne de paie ajoutée commence hors total ; on la glisse dans le total depuis DONNEES.</p>
      </div>
      {erreur && <p className="champ-erreur admin-erreur admin-erreur-bloc" role="alert">{erreur}</p>}
      {d.colonnes.length === 0 ? (
        <Etat type="vide" titre="Aucune colonne" aide="" />
      ) : (
        <table className="dense">
          <thead>
            <tr>{COLONNES.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
          </thead>
          <tbody>
            {d.colonnes.map((c) => (
              <tr key={c.id}>
                <th scope="row">{c.libelle}</th>
                <td>{NATURES[c.nature]}</td>
                <td>{c.unite}</td>
                <td className="num">{c.valeurs.toLocaleString('fr-FR')}</td>
                <td>{c.dernier_mois ? MOIS[c.dernier_mois - 1] : '—'}</td>
                <td>
                  <span className={c.actif ? 'statut statut-ok' : 'statut'}>{c.actif ? 'Active' : 'Inactive'}</span>
                  {c.actif && c.valeurs === 0 && <Badge ton="alerte">Vide</Badge>}
                </td>
                <td className="actions">
                  {c.moteur ? (
                    <span className="note" title="Lue par le calcul des KPI : ne peut pas être désactivée.">Utilisée par les KPI</span>
                  ) : (
                    <Bouton
                      variante="lien"
                      aria-label={`${c.actif ? 'Désactiver' : 'Réactiver'} ${c.libelle}`}
                      disabled={activer.isPending}
                      onClick={() => basculer(c)}
                    >
                      {c.actif ? 'Désactiver' : 'Réactiver'}
                    </Bouton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Confirmer
        ouvert={!!aDesactiver}
        titre={`Désactiver « ${aDesactiver?.libelle ?? ''} » ?`}
        confirmer="Désactiver"
        desactive={activer.isPending}
        onConfirmer={() => aDesactiver && changer(aDesactiver, false)}
        onAnnuler={() => setADesactiver(null)}
      >
        <p>
          {aDesactiver ? `${nb(aDesactiver.valeurs)} en ${d.annee}. ` : ''}La colonne n’est plus lue à l’import ni affichée dans les
          tableaux ; l’historique est gardé et on peut la réactiver.
        </p>
      </Confirmer>
    </Panneau>
  )
}
