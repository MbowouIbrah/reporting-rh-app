import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import PageConnexion from '../components/PageConnexion'
import { messagePanne } from '../lib/connexion'

/** Connexion par lien (démo, invitation) : le jeton est dans le fragment (#), qui ne part jamais vers le serveur. */
export default function ConnexionRapide() {
  const { hash } = useLocation()
  const navigate = useNavigate()
  const { connexionLien } = useAuth()
  const [jeton] = useState(() => new URLSearchParams(hash.slice(1)).get('jeton') ?? '')
  const [erreur, setErreur] = useState<string | null>(jeton ? null : 'Ce lien est incomplet.')
  const lance = useRef(false)

  useEffect(() => {
    if (hash) navigate({ hash: '' }, { replace: true })
  }, [hash, navigate])

  useEffect(() => {
    if (!jeton || lance.current) return
    lance.current = true
    connexionLien(jeton)
      .then(() => navigate('/resume', { replace: true }))
      .catch((err: unknown) =>
        setErreur(
          err instanceof ApiError && err.status === 401
            ? 'Ce lien est invalide ou a expiré.'
            : err instanceof ApiError && err.status === 429
              ? 'Trop d’essais. Réessayez dans une minute.'
              : messagePanne(err, 'Connexion impossible pour le moment. Réessayez.'),
        ),
      )
  }, [jeton, connexionLien, navigate])

  return (
    <PageConnexion>
      <p className="login-form-eyebrow">Connexion directe</p>
      <h2 className="login-form-title">{erreur ? 'Lien non valable' : 'Ouverture de la session…'}</h2>
      {erreur ? (
        <>
          <div role="alert" className="alert">
            {erreur}
          </div>
          <p className="login-retour">
            <Link className="btn-link" to="/login">
              Se connecter avec son mot de passe
            </Link>
          </p>
        </>
      ) : (
        <p role="status" className="login-form-sub">
          Vérification du lien en cours.
        </p>
      )}
    </PageConnexion>
  )
}
