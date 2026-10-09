import { AXES, TITRES, type Pilotage } from '../../../api/pilotage'
import { Bouton, Carte } from '../../../components/Kit'
import { fcfa, MOIS } from '../../../lib/format'

/** Résumé des budgets du mois, par axe du MENSUEL ; la saisie se fait sur un écran dédié. */
export default function CarteBudgets({ vue, periode, onSaisir }: { vue: Pilotage; periode: string; onSaisir: () => void }) {
  return (
    <Carte titre="Budgets du mois">
      <ul className="pilotage-resume">
        {AXES.map((axe) => {
          const liste = vue.budgets[axe]
          const n = liste.filter((x) => x.valeur !== null).length
          return (
            <li key={axe}>
              <span>{TITRES[axe]}</span>
              <span className="note">{n} sur {liste.length}</span>
              <strong>{vue.totaux[axe] == null ? '—' : `${fcfa(vue.totaux[axe])} FCFA`}</strong>
            </li>
          )
        })}
      </ul>
      {vue.reprise && (
        <p className="note">
          Aucun budget pour {periode} : ceux de {MOIS[vue.reprise.mois - 1]} {vue.reprise.annee} pourront servir de point de départ.
        </p>
      )}
      <div className="saisie-carte-action">
        <Bouton onClick={onSaisir}>Saisir les budgets de {periode} →</Bouton>
      </div>
    </Carte>
  )
}
