import { Bell } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMarquerLue, useNotifications, useToutLu, type Notification } from '../api/notifications'
import { Bouton } from './Kit'

const date = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Cloche de l'en-tête : nombre de notifications non lues et liste déroulante. */
export default function Cloche() {
  const { data } = useNotifications()
  const marquer = useMarquerLue()
  const toutLu = useToutLu()
  const [ouvert, setOuvert] = useState(false)
  const zone = useRef<HTMLDivElement>(null)
  const bouton = useRef<HTMLButtonElement>(null)
  const nonLues = data?.non_lues ?? 0

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

  const ouvrir = (n: Notification) => {
    if (!n.lue) marquer.mutate(n.id)
    setOuvert(false)
  }

  return (
    <div className="cloche" ref={zone}>
      <button
        ref={bouton}
        type="button"
        className="cloche-bouton"
        aria-label={nonLues ? `Notifications, ${nonLues} non lue${nonLues > 1 ? 's' : ''}` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-controls="cloche-liste"
        onClick={() => setOuvert((o) => !o)}
      >
        <Bell aria-hidden="true" size={20} strokeWidth={1.75} />
        {nonLues > 0 && <span className="cloche-compte" aria-hidden="true">{nonLues > 99 ? '99+' : nonLues}</span>}
      </button>
      {ouvert && (
        <div id="cloche-liste" className="cloche-menu">
          <div className="cloche-entete">
            <span className="cloche-titre">Notifications</span>
            {nonLues > 0 && (
              <Bouton variante="lien" onClick={() => toutLu.mutate()} disabled={toutLu.isPending}>
                Tout marquer comme lu
              </Bouton>
            )}
          </div>
          {data?.notifications.length ? (
            <ul className="cloche-liste">
              {data.notifications.map((n) => (
                <li key={n.id} className={n.lue ? 'cloche-item' : 'cloche-item non-lue'}>
                  <span className="cloche-item-titre">{n.titre}</span>
                  <span className="cloche-item-texte">{n.texte}</span>
                  <span className="cloche-item-pied">
                    <time dateTime={n.cree_le}>{date(n.cree_le)}</time>
                    {n.lien ? (
                      <Link to={n.lien} className="btn-link" onClick={() => ouvrir(n)}>Ouvrir</Link>
                    ) : (
                      !n.lue && <Bouton variante="lien" onClick={() => marquer.mutate(n.id)}>Marquer comme lu</Bouton>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cloche-vide">Aucune notification.</p>
          )}
        </div>
      )}
    </div>
  )
}
