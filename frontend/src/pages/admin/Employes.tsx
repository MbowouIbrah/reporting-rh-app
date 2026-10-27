import { useAttente } from '../../hooks/useAttente'
import { useState, type FormEvent } from 'react'
import {
  CHAMPS_FICHE,
  useCreerSalarie,
  useListes,
  useModifierSalarie,
  useSalaries,
  type ChampFiche,
  type Fiche,
  type FicheIn,
} from '../../api/admin'
import AdminNav from '../../components/AdminNav'
import { Panneau } from '../../components/BlocsRapport'
import BoutonReinitialiser from '../../components/BoutonReinitialiser'
import Etat, { etatErreur } from '../../components/Etat'
import { Bouton, Champ } from '../../components/Kit'

const LIBELLES: Record<ChampFiche, string> = {
  poste: 'Poste',
  type_contrat: 'Type de contrat',
  activite: 'Activité',
  site: 'Site',
  service: 'Service',
}
const COLONNES = ['Matricule', 'Nom', ...Object.values(LIBELLES), 'Statut', 'Actions']
const VIDE: FicheIn = { matricule: '', nom: '', poste: null, type_contrat: null, activite: null, site: null, service: null, actif: true }

// Recherche sans accents ni casse, comme le choix d'employé des filtres.
const plier = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

type Edition = { id?: number; fiche: FicheIn }

function FormulaireEmploye({ edition, onFin }: { edition: Edition; onFin: () => void }) {
  const listes = useListes()
  const creer = useCreerSalarie()
  const modifier = useModifierSalarie()
  const [fiche, setFiche] = useState<FicheIn>(edition.fiche)
  const [erreurs, setErreurs] = useState<Record<string, string>>({})
  const [erreurApi, setErreurApi] = useState<string | null>(null)
  const envoi = creer.isPending || modifier.isPending
  const maj = <K extends keyof FicheIn>(c: K, v: FicheIn[K]) => setFiche((f) => ({ ...f, [c]: v }))

  const envoyer = (e: FormEvent) => {
    e.preventDefault()
    const err: Record<string, string> = {}
    if (!fiche.matricule.trim()) err.matricule = 'Matricule obligatoire'
    if (!fiche.nom.trim()) err.nom = 'Nom obligatoire'
    setErreurs(err)
    setErreurApi(null)
    if (Object.keys(err).length) return
    const corps = { ...fiche, matricule: fiche.matricule.trim(), nom: fiche.nom.trim() }
    const opts = { onSuccess: onFin, onError: (x: Error) => setErreurApi(x.message) }
    if (edition.id === undefined) creer.mutate(corps, opts)
    else modifier.mutate({ ...corps, id: edition.id }, opts)
  }

  return (
    <Panneau titre={edition.id === undefined ? 'Nouvel employé' : 'Modifier l’employé'}>
      <form className="admin-form" onSubmit={envoyer} noValidate>
        <Champ label="Matricule" erreur={erreurs.matricule}>
          {(p) => <input {...p} value={fiche.matricule} disabled={edition.id !== undefined} onChange={(e) => maj('matricule', e.target.value)} />}
        </Champ>
        <Champ label="Nom" erreur={erreurs.nom}>
          {(p) => <input {...p} value={fiche.nom} onChange={(e) => maj('nom', e.target.value)} />}
        </Champ>
        {CHAMPS_FICHE.map((c) => (
          <Champ key={c} label={LIBELLES[c]}>
            {(p) => (
              <select {...p} value={fiche[c] ?? ''} onChange={(e) => maj(c, e.target.value || null)}>
                <option value="">Non renseigné</option>
                {listes.data?.[c].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
          </Champ>
        ))}
        <label className="admin-case">
          <input type="checkbox" checked={fiche.actif} onChange={(e) => maj('actif', e.target.checked)} />
          Employé actif
        </label>
        {erreurApi && <p className="champ-erreur admin-erreur" role="alert">{erreurApi}</p>}
        <div className="admin-actions">
          <button type="submit" className="bouton bouton-primaire" disabled={envoi}>
            {edition.id === undefined ? 'Créer l’employé' : 'Enregistrer'}
          </button>
          <Bouton variante="secondaire" onClick={onFin} disabled={envoi}>Annuler</Bouton>
        </div>
      </form>
    </Panneau>
  )
}

export default function Employes() {
  const q = useSalaries()
  const [premier] = useAttente(q.isLoading)
  const modifier = useModifierSalarie()
  const [recherche, setRecherche] = useState('')
  const [edition, setEdition] = useState<Edition | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  const mots = plier(recherche.trim())
  const liste = (q.data ?? []).filter((s) => !mots || plier(`${s.matricule} ${s.nom}`).includes(mots))
  const ouvrir = (e: Edition) => {
    setErreur(null)
    setEdition(e)
  }
  const basculer = (s: Fiche) => {
    setErreur(null)
    modifier.mutate({ ...s, actif: !s.actif }, { onError: (e) => setErreur(e.message) })
  }

  return (
    <section className="page-ecran rapport-excel admin-excel">
      <AdminNav />
      <div className="filtres" role="group" aria-label="Recherche">
        <label>
          Recherche
          <input type="search" placeholder="Nom ou matricule" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        </label>
        <BoutonReinitialiser actif={!!recherche} onClick={() => setRecherche('')} libelle="Effacer la recherche" />
        <Bouton className="admin-ajout" onClick={() => ouvrir({ fiche: VIDE })}>Nouvel employé</Bouton>
      </div>
      {q.isError && !premier && <Etat type={etatErreur(q.error)} onRetry={() => q.refetch()} />}
      {premier && <Etat type="chargement" colonnes={COLONNES} lignes={6} />}
      {q.data && !premier && (
        <>
          <p className="bandeau">
            <span className="val">{`${liste.length} employé${liste.length > 1 ? 's' : ''}`}</span>
          </p>
          {erreur && <p className="bandeau ko" role="alert">{erreur}</p>}
          {edition && (
            <FormulaireEmploye
              key={edition.id ?? 'nouveau'}
              edition={edition}
              onFin={() => setEdition(null)}
            />
          )}
          {liste.length === 0 ? (
            <Etat type="vide" titre={q.data.length ? 'Aucun employé ne correspond à la recherche' : 'Aucun employé'} aide="" />
          ) : (
            <Panneau titre="Employés">
              <table className="dense">
                <thead>
                  <tr>{COLONNES.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {liste.map((s) => (
                    <tr key={s.id}>
                      <th scope="row">{s.matricule}</th>
                      <td>{s.nom}</td>
                      {CHAMPS_FICHE.map((c) => <td key={c}>{s[c] ?? '—'}</td>)}
                      <td><span className={s.actif ? 'statut statut-ok' : 'statut'}>{s.actif ? 'Actif' : 'Inactif'}</span></td>
                      <td className="actions">
                        <Bouton variante="lien" aria-label={`Modifier ${s.nom}`} onClick={() => ouvrir({ id: s.id, fiche: s })}>Modifier</Bouton>
                        <Bouton variante="lien" aria-label={`${s.actif ? 'Désactiver' : 'Réactiver'} ${s.nom}`} disabled={modifier.isPending} onClick={() => basculer(s)}>
                          {s.actif ? 'Désactiver' : 'Réactiver'}
                        </Bouton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panneau>
          )}
        </>
      )}
    </section>
  )
}
