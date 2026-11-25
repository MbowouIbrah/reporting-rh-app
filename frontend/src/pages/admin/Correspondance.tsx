import { useState, type FormEvent } from 'react'
import {
  useCorrespondance,
  useCreerCorrespondance,
  useModifierCorrespondance,
  useRemplissage,
  useSupprimerCorrespondance,
  type LigneCorrespondance,
} from '../../api/admin'
import AdminNav from '../../components/AdminNav'
import { Panneau } from '../../components/BlocsRapport'
import Etat, { etatErreur } from '../../components/Etat'
import { Bouton, Champ, Confirmer } from '../../components/Kit'

interface Edition {
  id: number
  colonne: string
  rubrique_id: string
}

/** Colonnes du fichier de paie additionnées dans chaque rubrique de l'application ; les autres colonnes sont ignorées. */
export default function Correspondance() {
  const q = useCorrespondance()
  const rubriques = useRemplissage(null)
  const creer = useCreerCorrespondance()
  const modifier = useModifierCorrespondance()
  const supprimer = useSupprimerCorrespondance()
  const [colonne, setColonne] = useState('')
  const [rubrique, setRubrique] = useState('')
  const [erreurColonne, setErreurColonne] = useState<string | null>(null)
  const [erreurRubrique, setErreurRubrique] = useState<string | null>(null)
  const [erreurAjout, setErreurAjout] = useState<string | null>(null)
  const [edition, setEdition] = useState<Edition | null>(null)
  const [aSupprimer, setASupprimer] = useState<LigneCorrespondance | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  const choix = (rubriques.data?.colonnes ?? []).filter((c) => c.nature === 'paie' && c.actif)
  const surErreur = (e: Error) => setErreur(e.message)

  const ajouter = (e: FormEvent) => {
    e.preventDefault()
    setErreurAjout(null)
    setErreurColonne(colonne.trim() ? null : 'Colonne obligatoire')
    setErreurRubrique(rubrique ? null : 'Rubrique obligatoire')
    if (!colonne.trim() || !rubrique) return
    creer.mutate(
      { colonne: colonne.trim(), rubrique_id: Number(rubrique) },
      { onSuccess: () => { setColonne(''); setRubrique('') }, onError: (x) => setErreurAjout(x.message) },
    )
  }
  const enregistrer = (e: FormEvent) => {
    e.preventDefault()
    if (!edition || !edition.colonne.trim() || !edition.rubrique_id) return
    setErreur(null)
    modifier.mutate(
      { id: edition.id, colonne: edition.colonne.trim(), rubrique_id: Number(edition.rubrique_id) },
      { onSuccess: () => setEdition(null), onError: surErreur },
    )
  }
  const retirer = () => {
    if (!aSupprimer) return
    setErreur(null)
    supprimer.mutate(aSupprimer.id, { onSettled: () => setASupprimer(null), onError: surErreur })
  }

  const entetes = ['Colonne de la paie', 'Rubrique de l’application', 'Actions']
  const lignes = q.data ?? []
  return (
    <section className="page-ecran rapport-excel admin-excel">
      <AdminNav />
      <Panneau titre="Colonnes de paie et rubriques">
        <p className="note">
          Chaque colonne du fichier de paie listée ici est additionnée dans la rubrique choisie. Plusieurs colonnes peuvent aller
          dans la même rubrique ; les colonnes qui ne sont pas listées sont ignorées.
        </p>
        <form className="admin-form" aria-label="Ajouter une correspondance" onSubmit={ajouter} noValidate>
          <Champ label="Colonne de la paie" erreur={erreurColonne}>
            {(p) => <input {...p} value={colonne} onChange={(e) => setColonne(e.target.value)} />}
          </Champ>
          <Champ label="Rubrique" erreur={erreurRubrique}>
            {(p) => (
              <select {...p} value={rubrique} onChange={(e) => setRubrique(e.target.value)}>
                <option value="">Choisir…</option>
                {choix.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
              </select>
            )}
          </Champ>
          <div className="admin-actions en-ligne">
            <button type="submit" className="bouton bouton-primaire" disabled={creer.isPending}>Ajouter</button>
          </div>
          {erreurAjout && <p className="champ-erreur admin-erreur" role="alert">{erreurAjout}</p>}
        </form>
        {erreur && <p className="champ-erreur admin-erreur admin-erreur-bloc" role="alert">{erreur}</p>}
        {q.isLoading ? (
          <Etat type="chargement" colonnes={entetes} lignes={4} />
        ) : q.isError ? (
          <Etat type={etatErreur(q.error)} onRetry={() => q.refetch()} />
        ) : lignes.length === 0 ? (
          <Etat type="vide" titre="Aucune correspondance" aide="Sans correspondance, aucun montant n’est lu dans le fichier de paie." />
        ) : (
          <table className="dense">
            <thead>
              <tr>{entetes.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id}>
                  {edition?.id === l.id ? (
                    <td colSpan={3}>
                      <form className="renommer" onSubmit={enregistrer} noValidate>
                        <input
                          aria-label={`Colonne de la paie de ${l.colonne}`}
                          value={edition.colonne}
                          onChange={(e) => setEdition({ ...edition, colonne: e.target.value })}
                        />
                        <select
                          aria-label={`Rubrique de ${l.colonne}`}
                          value={edition.rubrique_id}
                          onChange={(e) => setEdition({ ...edition, rubrique_id: e.target.value })}
                        >
                          {choix.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
                        </select>
                        <button type="submit" className="bouton bouton-primaire" disabled={modifier.isPending || !edition.colonne.trim()}>Enregistrer</button>
                        <Bouton variante="secondaire" disabled={modifier.isPending} onClick={() => setEdition(null)}>Annuler</Bouton>
                      </form>
                    </td>
                  ) : (
                    <>
                      <th scope="row">{l.colonne}</th>
                      <td>{l.rubrique}</td>
                      <td className="actions">
                        <Bouton
                          variante="lien"
                          aria-label={`Modifier ${l.colonne}`}
                          onClick={() => {
                            setErreur(null)
                            setEdition({ id: l.id, colonne: l.colonne, rubrique_id: String(l.rubrique_id) })
                          }}
                        >
                          Modifier
                        </Bouton>
                        <Bouton variante="lien" aria-label={`Supprimer ${l.colonne}`} onClick={() => setASupprimer(l)}>
                          Supprimer
                        </Bouton>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panneau>
      <Confirmer
        ouvert={!!aSupprimer}
        titre="Supprimer cette correspondance ?"
        confirmer="Supprimer"
        desactive={supprimer.isPending}
        onConfirmer={retirer}
        onAnnuler={() => setASupprimer(null)}
      >
        {aSupprimer && <p>La colonne « {aSupprimer.colonne} » ne sera plus lue dans le fichier de paie.</p>}
      </Confirmer>
    </section>
  )
}
