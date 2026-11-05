import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { abonnerConnexion, connexionPerdue, verifierConnexion } from '../lib/etatConnexion'

const INTERVALLE_SONDE = 5_000
const DUREE_ANNONCE_RETOUR = 5_000

/**
 * Annonce la panne, sonde le serveur tant qu'elle dure et, à son retour, relance les requêtes en
 * erreur, celles encore en cours de relance et les données périmées affichées.
 */
export default function BandeauConnexion() {
  const perdue = useSyncExternalStore(abonnerConnexion, connexionPerdue)
  const qc = useQueryClient()
  const [essai, setEssai] = useState(false)
  const [retour, setRetour] = useState(false)
  const bandeau = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const verifier = () => void verifierConnexion()
    if (!navigator.onLine) verifier()
    window.addEventListener('online', verifier)
    window.addEventListener('offline', verifier)
    return () => {
      window.removeEventListener('online', verifier)
      window.removeEventListener('offline', verifier)
    }
  }, [])

  const avant = useRef(perdue)
  useEffect(() => {
    const revenu = avant.current && !perdue
    avant.current = perdue
    if (revenu) {
      // Marquer d'abord (sans relire), puis une seule relecture des requêtes actives périmées :
      // celles en erreur, celles en pleine relance, et les données gardées pendant la panne.
      void qc.invalidateQueries({
        predicate: (q) => q.state.status === 'error' || q.state.fetchFailureCount > 0,
        refetchType: 'none',
      })
      void qc.refetchQueries({ type: 'active', stale: true })
      setRetour(true)
      const t = setTimeout(() => setRetour(false), DUREE_ANNONCE_RETOUR)
      return () => clearTimeout(t)
    }
    if (!perdue) return
    const minuteur = setInterval(() => void verifierConnexion(), INTERVALLE_SONDE)
    return () => clearInterval(minuteur)
  }, [perdue, qc])

  // Hauteur du bandeau, pour que les écrans pleine hauteur et leurs pieds collés restent au-dessus.
  useLayoutEffect(() => {
    const el = bandeau.current
    const racine = document.documentElement.style
    if (!el) return
    const mesurer = () => racine.setProperty('--bandeau-h', `${el.offsetHeight}px`)
    mesurer()
    const obs = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(mesurer)
    obs?.observe(el)
    return () => {
      obs?.disconnect()
      racine.removeProperty('--bandeau-h')
    }
  }, [perdue])

  const reessayer = () => {
    if (essai) return
    setEssai(true)
    void verifierConnexion().finally(() => setEssai(false))
  }
  return (
    <>
      {/* Zone d'annonce toujours présente : la panne et le retour sont lus par les lecteurs d'écran. */}
      <p className="sr-only" role="status">
        {perdue ? 'Connexion perdue. La page se remettra à jour au retour du réseau.' : retour ? 'Connexion rétablie.' : ''}
      </p>
      {perdue && (
        <div ref={bandeau} className="bandeau-connexion">
          <span aria-hidden="true"><strong>Connexion perdue.</strong> La page se remettra à jour au retour du réseau.</span>
          <button type="button" className="bouton bouton-secondaire" aria-busy={essai} onClick={reessayer}>
            {essai ? 'Vérification…' : 'Réessayer'}
          </button>
        </div>
      )}
    </>
  )
}
