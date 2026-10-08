import { usePerimetresAdmin, useUsers, type PerimetreAdmin, type RoleAdmin } from '../../api/admin'
import AdminNav from '../../components/AdminNav'
import Etat from '../../components/Etat'
import { Badge, Carte } from '../../components/Kit'
import { ROLES } from '../../lib/roles'


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
  const pers = perimetres.data ?? []
  const chargement = users.isLoading || perimetres.isLoading
  const erreur = users.isError || perimetres.isError
  return (
    <>
      <AdminNav />
      <h2>Accès : qui voit quoi</h2>
      {chargement && <Etat type="chargement" />}
      {erreur && (
        <Etat
          type="erreur"
          onRetry={() => {
            users.refetch()
            perimetres.refetch()
          }}
        />
      )}
      {!chargement && !erreur && (
        <>
      <Carte
        titre={`Utilisateurs (${users.data?.length ?? 0})`}
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
      )}
    </>
  )
}
