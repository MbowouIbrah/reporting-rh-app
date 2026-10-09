import { CircleUserRound, LogOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ROLES } from '../lib/roles'

/** Icône profil de la barre : ouvre un menu avec l'adresse, le rôle et la déconnexion. */
export default function MenuProfil() {
  const { me, logout } = useAuth()
  const navigate = useNavigate()
  const [ouvert, setOuvert] = useState(false)
  const zone = useRef<HTMLDivElement>(null)
  const bouton = useRef<HTMLButtonElement>(null)
  const role = me?.roles[0]?.role

  useEffect(() => {
    if (!ouvert) return
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
          <span className="profil-email">{me?.email}</span>
          {role && <span className="badge badge-neutre">{ROLES[role as keyof typeof ROLES]?.libelle ?? role}</span>}
          <button
            type="button"
            className="btn-link profil-sortie"
            onClick={async () => {
              await logout()
              navigate('/login')
            }}
          >
            <LogOut aria-hidden="true" size={15} />
            Déconnexion
          </button>
        </div>
      )}
    </div>
  )
}
