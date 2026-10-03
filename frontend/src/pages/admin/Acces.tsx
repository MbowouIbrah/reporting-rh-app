import { Link } from 'react-router-dom'
import { usePerimetresAdmin, useUsers, type PerimetreAdmin, type RoleAdmin } from '../../api/admin'
import AdminNav from '../../components/AdminNav'
import Etat from '../../components/Etat'
import { Badge, Carte } from '../../components/Kit'

const ROLES = {
  rh_admin: {
    libelle: 'Administrateur RH',
    resume: 'Tout voir, saisir les données, gérer les comptes, les périmètres et les réglages.',
  },
  lecteur_global: {
    libelle: 'Lecteur global',
    resume: 'Consulter tous les rapports, noms et marges compris. Aucune modification.',
  },
  lecteur_perimetre: {
    libelle: 'Lecteur de périmètre',
    resume: 'Consulter uniquement les services et sites de son périmètre. Les noms ne sont visibles que si c’est autorisé. Pas de marge.',
  },
} as const

function libellePerimetre(r: RoleAdmin, perimetres: PerimetreAdmin[]) {
  if (r.role !== 'lecteur_perimetre') return 'Toute l’entreprise'
  const p = perimetres.find((x) => x.id === r.perimetre_id)
  if (!p) return '—'
  const par = (d: string) => p.regles.filter((x) => x.dimension === d).map((x) => x.valeur)
  const parts = [par('service').length && `Services : ${par('service').join(', ')}`, par('site').length && `Sites : ${par('site').join(', ')}`]
  return (
    <>
      <strong>{p.libelle}</strong>
      <br />
      <span className="note">{parts.filter(Boolean).join(' · ') || 'Aucune règle'}</span>
    </>
  )
}

export default function Acces() {
  const users = useUsers()
  const perimetres = usePerimetresAdmin()
  if (users.isLoading || perimetres.isLoading) return <Etat type="chargement" />
  if (users.isError) return <Etat type="erreur" onRetry={() => users.refetch()} />
  const pers = perimetres.data ?? []
  return (
    <>
      <AdminNav />
      <h2>Accès : qui voit quoi</h2>
      <Carte
        titre={`Utilisateurs (${users.data?.length ?? 0})`}
        actions={
          <span className="note">
            <Link to="/admin/utilisateurs">Gérer les comptes</Link> · <Link to="/admin/perimetres">Gérer les périmètres</Link>
          </span>
        }
      >
        <div className="tableau-defilant">
          <table className="dense">
            <thead>
              <tr>
                <th scope="col">Nom</th>
                <th scope="col">E-mail</th>
                <th scope="col">Rôle</th>
                <th scope="col">Données visibles</th>
                <th scope="col">Voit les noms</th>
                <th scope="col">Peut modifier</th>
                <th scope="col">Statut</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.map((u) =>
                (u.roles.length ? u.roles : [null]).map((r, i) => (
                  <tr key={`${u.id}-${i}`}>
                    <th scope="row">{i === 0 ? u.nom : ''}</th>
                    <td>{i === 0 ? u.email : ''}</td>
                    <td>{r ? ROLES[r.role].libelle : 'Aucun rôle'}</td>
                    <td>{r ? libellePerimetre(r, pers) : '—'}</td>
                    <td>{r ? (r.role !== 'lecteur_perimetre' || r.nominatif ? 'Oui' : 'Non') : '—'}</td>
                    <td>{r?.role === 'rh_admin' ? 'Oui' : 'Non'}</td>
                    <td>{i === 0 && <Badge ton={u.actif ? 'succes' : 'neutre'}>{u.actif ? 'Actif' : 'Désactivé'}</Badge>}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </Carte>
      <Carte titre="Ce que permet chaque rôle">
        <dl className="roles-aide">
          {Object.values(ROLES).map((r) => (
            <div key={r.libelle}>
              <dt>{r.libelle}</dt>
              <dd>{r.resume}</dd>
            </div>
          ))}
        </dl>
      </Carte>
    </>
  )
}
