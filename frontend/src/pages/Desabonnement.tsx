import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { desabonner } from '../api/notifications'
import PageConnexion from '../components/PageConnexion'
import { messagePanne } from '../lib/connexion'

/** Lien d'arrêt des e-mails de notification : le jeton est dans le fragment (#), seul le bouton désabonne. */
export default function Desabonnement() {
  const { hash } = useLocation()
  const navigate = useNavigate()
  const [jeton] = useState(() => new URLSearchParams(hash.slice(1)).get('jeton') ?? '')
  const [fait, setFait] = useState(false)
  const [erreur, setErreur] = useState<string | null>(jeton ? null : 'Ce lien est incomplet.')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (hash) navigate({ hash: '' }, { replace: true })
  }, [hash, navigate])

  async function confirmer() {
    setBusy(true)
    setErreur(null)
    try {
      await desabonner(jeton)
      setFait(true)
    } catch (err) {
      setErreur(
        err instanceof ApiError && err.status === 400
          ? 'Ce lien est invalide.'
          : messagePanne(err, 'Désabonnement impossible pour le moment. Réessayez.'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageConnexion>
      <p className="login-form-eyebrow">Notifications</p>
      <h2 className="login-form-title">Ne plus recevoir d’e-mails</h2>
      {fait ? (
        <div role="status" className="login-succes">
          Vous ne recevrez plus d’e-mails de notification. Vous pouvez les réactiver à tout moment depuis votre profil.
        </div>
      ) : (
        <>
          <p className="login-form-sub">
            Vous ne serez plus prévenu par e-mail quand les données d’un mois sont disponibles. Les notifications de la cloche restent actives.
          </p>
          {erreur && (
            <div role="alert" className="alert">
              {erreur}
            </div>
          )}
          {jeton && (
            <button className="btn login-submit" type="button" disabled={busy} onClick={confirmer}>
              Me désabonner
            </button>
          )}
        </>
      )}
      <p className="login-retour">
        <Link className="btn-link" to="/login">
          Aller à la connexion
        </Link>
      </p>
    </PageConnexion>
  )
}
