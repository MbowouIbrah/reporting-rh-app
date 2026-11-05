import { Component, type ReactNode } from 'react'
import Etat from './Etat'

// Messages des navigateurs quand le code d'une page chargée à la demande n'arrive pas.
const CODE_NON_CHARGE = /dynamically imported module|Importing a module script failed|Loading (CSS )?chunk/i

/**
 * Page chargée à la demande qui ne s'affiche pas : un message et Réessayer plutôt qu'un écran blanc.
 * Le rechargement récupère le code au retour du réseau. `page` : hors de Layout, la limite porte le <main>.
 */
export default class LimiteErreur extends Component<{ children: ReactNode; page?: boolean }, { echec: boolean; reseau: boolean }> {
  state = { echec: false, reseau: false }

  static getDerivedStateFromError(e: unknown) {
    return { echec: true, reseau: e instanceof Error && CODE_NON_CHARGE.test(e.message) }
  }

  render() {
    if (!this.state.echec) return this.props.children
    const etat = this.state.reseau ? (
      <Etat type="reseau" titre="Page non chargée" aide="Vérifiez le réseau, puis réessayez." onRetry={() => location.reload()} />
    ) : (
      <Etat type="erreur" titre="Page non affichée" aide="Rechargez la page." onRetry={() => location.reload()} />
    )
    return this.props.page ? <main className="page">{etat}</main> : etat
  }
}
