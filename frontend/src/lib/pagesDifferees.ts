/** Pages chargées à part (graphiques lourds). Le même import sert au routage et au préchargement. */
export const chargerGraphes = () => import('../pages/Graphes')
export const chargerRapport = () => import('../pages/Rapport')

/** Charge le code de Graphes quand le navigateur est libre : la première ouverture est alors immédiate. */
export function prechargerGraphes(): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(() => void chargerGraphes())
    return () => cancelIdleCallback(id)
  }
  const id = window.setTimeout(() => void chargerGraphes(), 1500)
  return () => window.clearTimeout(id)
}
