import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { abonnerConnexion, connexionPerdue, verifierConnexion } from '../lib/etatConnexion'

const INTERVALLE_SONDE = 5_000

/** Annonce la panne, sonde le serveur tant qu'elle dure et relance les requêtes en erreur à son retour. */
export default function BandeauConnexion() {
  const perdue = useSyncExternalStore(abonnerConnexion, connexionPerdue)
  const qc = useQueryClient()
  const [essai, setEssai] = useState(false)

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
    const retour = avant.current && !perdue
    avant.current = perdue
    if (retour) void qc.invalidateQueries({ predicate: (q) => q.state.status === 'error' })
    if (!perdue) return
    const minuteur = setInterval(() => void verifierConnexion(), INTERVALLE_SONDE)
    return () => clearInterval(minuteur)
  }, [perdue, qc])

  if (!perdue) return null
  const reessayer = () => {
    setEssai(true)
    void verifierConnexion().finally(() => setEssai(false))
  }
  return (
    <div className="bandeau-connexion" role="alert">
      <span><strong>Connexion perdue.</strong> La page se remettra à jour au retour du réseau.</span>
      <button type="button" className="bouton bouton-secondaire" disabled={essai} onClick={reessayer}>
        {essai ? 'Vérification…' : 'Réessayer'}
      </button>
    </div>
  )
}
