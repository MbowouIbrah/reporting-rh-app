import { useState, type FormEvent } from 'react'
import {
  ROLES,
  useComptes,
  useCreerCompte,
  useModifierCompte,
  usePerimetres,
  useSupprimerCompte,
  type Affectation,
  type Compte,
  type Role,
} from '../../api/admin'
import { useAuth } from '../../auth/AuthContext'
import AdminNav from '../../components/AdminNav'
import { Panneau } from '../../components/BlocsRapport'
import BoutonReinitialiser from '../../components/BoutonReinitialiser'
import Etat, { etatErreur } from '../../components/Etat'
import { Bouton, Champ, Confirmer } from '../../components/Kit'

const TITRE = 'ADMINISTRATION DES UTILISATEURS'
export const LIBELLE_ROLE: Record<Role, string> = {
  rh_admin: 'Administrateur RH',
  lecteur_global: 'Lecteur global',
  lecteur_perimetre: 'Lecteur à périmètre',
}
const COLONNES = ['Nom', 'Adresse e-mail', 'Rôle', 'Périmètre', 'Détail nominatif', 'Statut', 'Actions']
// Mêmes règles que le serveur (admin.py) : messages immédiats, le serveur reste l'autorité.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MDP_MIN = 12

const plier = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

interface Fiche {
  email: string
  nom: string
  password: string
  role: Role
  perimetre_id: string
  nominatif: boolean
}
type Edition = { compte?: Compte }

// Le formulaire porte un rôle par compte (cadrage : une personne = une affectation).
function ficheDe(c?: Compte): Fiche {
  const r = c?.roles[0]
  return {
    email: c?.email ?? '',
    nom: c?.nom ?? '',
    password: '',
    role: r?.role ?? 'lecteur_perimetre',
    perimetre_id: r?.perimetre_id != null ? String(r.perimetre_id) : '',
    nominatif: r?.nominatif ?? false,
  }
}

// Les rôles globaux voient le détail nominatif d'office ; seul le lecteur à périmètre porte le choix.
const voitNominatif = (r: Affectation) => r.role !== 'lecteur_perimetre' || r.nominatif

function affectation(f: Fiche): Affectation {
  const perimetre = f.role === 'lecteur_perimetre'
  return { role: f.role, perimetre_id: perimetre ? Number(f.perimetre_id) : null, nominatif: perimetre ? f.nominatif : true }
}

function FormulaireCompte({ edition, soi, onFin }: { edition: Edition; soi: boolean; onFin: () => void }) {
  const perimetres = usePerimetres()
  const creer = useCreerCompte()
  const modifier = useModifierCompte()
  const nouveau = edition.compte === undefined
  const [initiale] = useState<Fiche>(() => ficheDe(edition.compte))
  const [fiche, setFiche] = useState<Fiche>(initiale)
  // Rôles envoyés seulement s'ils changent : un nom ou un mot de passe modifié ne touche pas aux affectations.
  const roleChange = nouveau || (['role', 'perimetre_id', 'nominatif'] as const).some((k) => fiche[k] !== initiale[k])
  const [erreurs, setErreurs] = useState<Record<string, string>>({})
  const [erreurApi, setErreurApi] = useState<string | null>(null)
  const envoi = creer.isPending || modifier.isPending
  const maj = <K extends keyof Fiche>(c: K, v: Fiche[K]) => setFiche((f) => ({ ...f, [c]: v }))

  const envoyer = (e: FormEvent) => {
    e.preventDefault()
    const err: Record<string, string> = {}
    if (!fiche.nom.trim()) err.nom = 'Nom obligatoire'
    if (nouveau && !EMAIL_RE.test(fiche.email.trim())) err.email = 'Adresse e-mail invalide'
    if ((nouveau || fiche.password) && fiche.password.length < MDP_MIN) err.password = `${MDP_MIN} caractères minimum`
    if (roleChange && fiche.role === 'lecteur_perimetre' && !fiche.perimetre_id) err.perimetre = 'Périmètre obligatoire'
    setErreurs(err)
    setErreurApi(null)
    if (Object.keys(err).length) return
    const opts = { onSuccess: onFin, onError: (x: Error) => setErreurApi(x.message) }
    const roles = [affectation(fiche)]
    if (nouveau) creer.mutate({ email: fiche.email.trim(), nom: fiche.nom.trim(), password: fiche.password, roles }, opts)
    else
      modifier.mutate(
        { id: edition.compte!.id, nom: fiche.nom.trim(), ...(roleChange ? { roles } : {}), ...(fiche.password ? { password: fiche.password } : {}) },
        opts,
      )
  }

  return (
    <Panneau titre={nouveau ? 'Nouvel utilisateur' : 'Modifier l’utilisateur'}>
      <form className="admin-form" onSubmit={envoyer} noValidate>
        <Champ label="Nom" erreur={erreurs.nom}>
          {(p) => <input {...p} value={fiche.nom} onChange={(e) => maj('nom', e.target.value)} />}
        </Champ>
        <Champ label="Adresse e-mail" erreur={erreurs.email}>
          {(p) => <input {...p} type="email" autoComplete="off" value={fiche.email} disabled={!nouveau} onChange={(e) => maj('email', e.target.value)} />}
        </Champ>
        <Champ label={nouveau ? 'Mot de passe' : 'Nouveau mot de passe (facultatif)'} erreur={erreurs.password}>
          {(p) => <input {...p} type="password" autoComplete="new-password" value={fiche.password} onChange={(e) => maj('password', e.target.value)} />}
        </Champ>
        <Champ label="Rôle">
          {(p) => (
            <select {...p} value={fiche.role} disabled={soi} onChange={(e) => maj('role', e.target.value as Role)}>
              {ROLES.map((r) => <option key={r} value={r}>{LIBELLE_ROLE[r]}</option>)}
            </select>
          )}
        </Champ>
        {fiche.role === 'lecteur_perimetre' && (
          <>
            <Champ label="Périmètre" erreur={erreurs.perimetre ?? (perimetres.isError ? 'Liste des périmètres indisponible' : undefined)}>
              {(p) => (
                <select {...p} value={fiche.perimetre_id} disabled={soi} onChange={(e) => maj('perimetre_id', e.target.value)}>
                  <option value="">Choisir…</option>
                  {perimetres.data?.map((x) => <option key={x.id} value={x.id}>{x.libelle}</option>)}
                </select>
              )}
            </Champ>
            <label className="admin-case">
              <input type="checkbox" checked={fiche.nominatif} disabled={soi} onChange={(e) => maj('nominatif', e.target.checked)} />
              Accès au détail nominatif
            </label>
          </>
        )}
        {soi && <p className="note admin-note" role="note">Votre propre rôle ne se modifie pas ici (évite de perdre l’accès).</p>}
        {(edition.compte?.roles.length ?? 0) > 1 && (
          <p className="note admin-note" role="note">Ce compte a plusieurs rôles : changer le rôle les remplace par celui choisi.</p>
        )}
        {erreurApi && <p className="champ-erreur admin-erreur" role="alert">{erreurApi}</p>}
        <div className="admin-actions">
          <button type="submit" className="bouton bouton-primaire" disabled={envoi}>
            {nouveau ? 'Créer l’utilisateur' : 'Enregistrer'}
          </button>
          <Bouton variante="secondaire" onClick={onFin} disabled={envoi}>Annuler</Bouton>
        </div>
      </form>
    </Panneau>
  )
}

export default function Utilisateurs() {
  const { me } = useAuth()
  const q = useComptes()
  const perimetres = usePerimetres()
  const modifier = useModifierCompte()
  const supprimer = useSupprimerCompte()
  const [recherche, setRecherche] = useState('')
  const [edition, setEdition] = useState<Edition | null>(null)
  const [aSupprimer, setASupprimer] = useState<Compte | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  const libellePerimetre = (id: number | null) =>
    id === null ? 'Tous' : (perimetres.data?.find((x) => x.id === id)?.libelle ?? `n° ${id}`)
  const mots = plier(recherche.trim())
  const liste = (q.data ?? []).filter((c) => !mots || plier(`${c.nom} ${c.email}`).includes(mots))
  const ouvrir = (e: Edition) => {
    setErreur(null)
    setEdition(e)
  }
  const basculer = (c: Compte) => {
    setErreur(null)
    modifier.mutate({ id: c.id, actif: !c.actif }, { onError: (e) => setErreur(e.message) })
  }
  const confirmerSuppression = () => {
    if (!aSupprimer) return
    setErreur(null)
    supprimer.mutate(aSupprimer.id, {
      onSuccess: () => {
        if (edition?.compte?.id === aSupprimer.id) setEdition(null)
        setASupprimer(null)
      },
      onError: (e) => {
        setASupprimer(null)
        setErreur(e.message)
      },
    })
  }

  return (
    <section className="page-ecran rapport-excel admin-excel">
      <h2 className="bandeau-titre">{TITRE}</h2>
      <AdminNav />
      <div className="filtres" role="group" aria-label="Recherche">
        <label>
          Recherche
          <input type="search" placeholder="Nom ou adresse" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        </label>
        <BoutonReinitialiser actif={!!recherche} onClick={() => setRecherche('')} libelle="Effacer la recherche" />
        <Bouton className="admin-ajout" onClick={() => ouvrir({})}>Nouvel utilisateur</Bouton>
      </div>
      {q.isError && <Etat type={etatErreur(q.error)} onRetry={() => q.refetch()} />}
      {q.isLoading && <Etat type="chargement" colonnes={COLONNES} lignes={6} />}
      {q.data && (
        <>
          <p className="bandeau">
            <span className="val">{`${liste.length} utilisateur${liste.length > 1 ? 's' : ''}`}</span>
          </p>
          {erreur && <p className="bandeau ko" role="alert">{erreur}</p>}
          {edition && <FormulaireCompte key={edition.compte?.id ?? 'nouveau'} edition={edition} soi={edition.compte?.id === me?.id} onFin={() => setEdition(null)} />}
          {liste.length === 0 ? (
            <Etat type="vide" titre={q.data.length ? 'Aucun utilisateur ne correspond à la recherche' : 'Aucun utilisateur'} aide="" />
          ) : (
            <Panneau titre="Utilisateurs">
              <table className="dense">
                <thead>
                  <tr>{COLONNES.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {liste.map((c) => {
                    const soi = c.id === me?.id
                    return (
                      <tr key={c.id}>
                        <th scope="row">{c.nom}{soi && <span className="note"> (vous)</span>}</th>
                        <td>{c.email}</td>
                        <td>{c.roles.map((r) => LIBELLE_ROLE[r.role] ?? r.role).join(', ') || '—'}</td>
                        <td>{c.roles.map((r) => libellePerimetre(r.perimetre_id)).join(', ') || '—'}</td>
                        <td>{c.roles.some(voitNominatif) ? 'Oui' : 'Non'}</td>
                        <td><span className={c.actif ? 'statut statut-ok' : 'statut'}>{c.actif ? 'Actif' : 'Inactif'}</span></td>
                        <td className="actions">
                          <Bouton variante="lien" aria-label={`Modifier ${c.nom}`} onClick={() => ouvrir({ compte: c })}>Modifier</Bouton>
                          {!soi && (
                            <>
                              <Bouton variante="lien" aria-label={`${c.actif ? 'Désactiver' : 'Réactiver'} ${c.nom}`} disabled={modifier.isPending} onClick={() => basculer(c)}>
                                {c.actif ? 'Désactiver' : 'Réactiver'}
                              </Bouton>
                              <Bouton variante="lien" aria-label={`Supprimer ${c.nom}`} disabled={supprimer.isPending} onClick={() => setASupprimer(c)}>
                                Supprimer
                              </Bouton>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Panneau>
          )}
        </>
      )}
      <Confirmer
        ouvert={!!aSupprimer}
        titre="Supprimer l’utilisateur ?"
        confirmer="Supprimer"
        desactive={supprimer.isPending}
        onConfirmer={confirmerSuppression}
        onAnnuler={() => setASupprimer(null)}
      >
        <p>{`${aSupprimer?.nom ?? ''} (${aSupprimer?.email ?? ''}) ne pourra plus se connecter. Pour garder une trace, préférez « Désactiver ».`}</p>
      </Confirmer>
    </section>
  )
}
