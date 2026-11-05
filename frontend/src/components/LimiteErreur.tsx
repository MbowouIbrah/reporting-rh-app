import { Component, type ReactNode } from 'react'
import Etat from './Etat'

/**
 * Code d'une page chargée à la demande indisponible (réseau coupé au premier affichage) : un message et
 * Réessayer plutôt qu'un écran blanc. Le rechargement récupère le code au retour du réseau.
 */
export default class LimiteErreur extends Component<{ children: ReactNode }, { echec: boolean }> {
  state = { echec: false }

  static getDerivedStateFromError() {
    return { echec: true }
  }

  render() {
    if (!this.state.echec) return this.props.children
    return (
      <main className="page">
        <Etat type="reseau" titre="Page non chargée" aide="Vérifiez le réseau, puis réessayez." onRetry={() => location.reload()} />
      </main>
    )
  }
}
