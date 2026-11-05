import { CircleUserRound, LogOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

/** Nom de l'utilisateur et icône profil de la barre : l'icône ouvre un menu avec l'adresse, le rôle et la déconnexion. */
export default function MenuProfil() {
  const { me, logout } = useAuth()
  const navigate = useNavigate()
  const [ouvert, setOuvert] = useState(false)
  const [echec, setEchec] = useState(false)
  const zone = useRef<HTMLDivElement>(null)
  const bouton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!ouvert) {
      setEchec(false)
      return
    }
    const dehors = (e: PointerEvent) => {
      if (!zone.current?.contains(e.target as Node)) setOuvert(false)
    }
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOuvert(false)
        bouton.current?.focus()
      }
    }
    document.addEventListener('pointerdown', dehors)
    document.addEventListener('keydown', touche)
    return () => {
      document.removeEventListener('pointerdown', dehors)
      document.removeEventListener('keydown', touche)
    }
  }, [ouvert])

  return (
    <div className="user profil" ref={zone}>
      <span className="profil-barre-nom" title={me?.nom || me?.email}>{me?.nom || me?.email}</span>
      <button
        ref={bouton}
        type="button"
        className="profil-bouton"
        aria-label="Profil"
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-controls="profil-menu"
        onClick={() => setOuvert((o) => !o)}
      >
        <CircleUserRound aria-hidden="true" size={22} strokeWidth={1.75} />
      </button>
      {ouvert && (
        <div id="profil-menu" className="profil-menu">
          <div className="profil-identite">
            <span className="profil-nom">{me?.nom || me?.email}</span>
            {me?.nom && <span className="profil-email">{me.email}</span>}
          </div>
          {me?.fonction && (
            <div className="profil-role">
              <span className="profil-libelle">Fonction</span>
              <span className="badge badge-neutre" title={me.fonction}>{me.fonction}</span>
            </div>
          )}
          <button
            type="button"
            className="btn-link profil-sortie"
            onClick={async () => {
              setEchec(false)
              try {
                await logout()
              } catch {
                setEchec(true)
                return
              }
              navigate('/login')
            }}
          >
            <LogOut aria-hidden="true" size={15} />
            Déconnexion
          </button>
          {echec && <p className="champ-erreur" role="alert">Déconnexion impossible : le serveur ne répond pas. Réessayez au retour du réseau.</p>}
        </div>
      )}
    </div>
  )
}
