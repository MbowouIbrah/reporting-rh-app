import { useState } from 'react'
import {
  useCreerUser,
  useModifierUser,
  usePerimetresAdmin,
  useSupprimerUser,
  useUsers,
  type RoleAdmin,
  type UserAdmin,
} from '../../api/admin'
import { useAuth } from '../../auth/AuthContext'
import AdminNav from '../../components/AdminNav'
import Etat from '../../components/Etat'
import { Badge, Bouton, Carte, Champ, Confirmer } from '../../components/Kit'

const ROLES = { rh_admin: 'Administrateur', lecteur_global: 'Lecteur global', lecteur_perimetre: 'Lecteur de périmètre' }

function Formulaire() {
  const creer = useCreerUser()
  const per = usePerimetresAdmin()
  const [f, setF] = useState({ email: '', nom: '', password: '' })
  const [role, setRole] = useState<RoleAdmin['role']>('lecteur_global')
  const [perimetre, setPerimetre] = useState('')
  const [nominatif, setNominatif] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const envoyer = () => {
    if (role === 'lecteur_perimetre' && !perimetre) return setErr('Choisir un périmètre')
    setErr(null)
    const r: RoleAdmin = {
      role,
      perimetre_id: role === 'lecteur_perimetre' ? Number(perimetre) : null,
      nominatif: role === 'lecteur_perimetre' && nominatif,
    }
    creer.mutate(
      { ...f, roles: [r] },
      { onSuccess: () => setF({ email: '', nom: '', password: '' }), onError: (e) => setErr(e.message) },
    )
  }

  return (
    <Carte titre="Nouvel utilisateur">
      <Champ label="E-mail">
        {(p) => <input {...p} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
      </Champ>
      <Champ label="Nom">
        {(p) => <input {...p} value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} />}
      </Champ>
      <Champ label="Mot de passe (12 caractères minimum)">
        {(p) => (
          <input
            {...p}
            type="password"
            autoComplete="new-password"
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
          />
        )}
      </Champ>
      <Champ label="Rôle">
        {(p) => (
          <select {...p} value={role} onChange={(e) => setRole(e.target.value as RoleAdmin['role'])}>
            {Object.entries(ROLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Champ>
      {role === 'lecteur_perimetre' && (
        <>
          <Champ label="Périmètre">
            {(p) => (
              <select {...p} value={perimetre} onChange={(e) => setPerimetre(e.target.value)}>
                <option value="">—</option>
                {per.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.libelle}
                  </option>
                ))}
              </select>
            )}
          </Champ>
          <label>
            <input type="checkbox" checked={nominatif} onChange={(e) => setNominatif(e.target.checked)} /> Accès nominatif
          </label>
        </>
      )}
      {err && (
        <p className="champ-erreur" role="alert">
          {err}
        </p>
      )}
      <Bouton onClick={envoyer} disabled={creer.isPending || !f.email || !f.nom || !f.password}>
        Créer
      </Bouton>
    </Carte>
  )
}

export default function Utilisateurs() {
  const q = useUsers()
  const { me } = useAuth()
  const modifier = useModifierUser()
  const supprimer = useSupprimerUser()
  const [cible, setCible] = useState<UserAdmin | null>(null)
  const [err, setErr] = useState<string | null>(null)

  if (q.isLoading) return <Etat type="chargement" />
  if (q.isError) return <Etat type="erreur" onRetry={() => q.refetch()} />

  const surErreur = (e: Error) => {
    setCible(null)
    setErr(e.message)
  }
  return (
    <>
      <AdminNav />
      <h2>Utilisateurs</h2>
      {err && (
        <p className="champ-erreur" role="alert">
          {err}
        </p>
      )}
      <div className="duo">
      <Carte>
        <table className="dense">
          <thead>
            <tr>
              <th>Nom</th>
              <th>E-mail</th>
              <th>Rôles</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((u) => (
              <tr key={u.id}>
                <td>{u.nom}</td>
                <td>{u.email}</td>
                <td>{u.roles.map((r) => ROLES[r.role]).join(', ')}</td>
                <td>
                  <Badge ton={u.actif ? 'succes' : 'neutre'}>{u.actif ? 'Actif' : 'Inactif'}</Badge>
                </td>
                <td>
                  <Bouton
                    variante="lien"
                    onClick={() =>
                      modifier.mutate({ id: u.id, actif: !u.actif }, { onSuccess: () => setErr(null), onError: surErreur })
                    }
                  >
                    {u.actif ? 'Désactiver' : 'Réactiver'}
                  </Bouton>
                  {u.id !== me?.id && (
                    <Bouton variante="lien" onClick={() => setCible(u)}>
                      Supprimer
                    </Bouton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Carte>
      <Formulaire />
      </div>
      <Confirmer
        ouvert={!!cible}
        titre="Supprimer l’utilisateur"
        confirmer="Supprimer"
        onAnnuler={() => setCible(null)}
        onConfirmer={() =>
          cible && supprimer.mutate(cible.id, { onSuccess: () => { setCible(null); setErr(null) }, onError: surErreur })
        }
      >
        <p>{cible?.email} sera supprimé définitivement.</p>
      </Confirmer>
    </>
  )
}
