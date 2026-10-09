import { AXES, TITRES } from '../../../api/pilotage'
import { Badge, Bouton } from '../../../components/Kit'
import { fcfa } from '../../../lib/format'
import BarreParcours from './BarreParcours'
import type { Verification } from './budgets'
import Etapes from './Etapes'

interface Props {
  periode: string
  verif: Verification
  envoi: { cours: boolean; erreur?: string }
  onRetour: () => void
  onEnregistrer: () => void
}

const pluriel = (n: number, s: string, p = `${s}s`) => `${n} ${n > 1 ? p : s}`

/** Vérification avant enregistrement des budgets, sur le modèle de la saisie des données. */
export default function VerifBudgets({ periode, verif, envoi, onRetour, onEnregistrer }: Props) {
  const { changements } = verif
  const n = changements.length
  return (
    <section className="page-ecran rapport-excel saisie-apercu saisie-budgets-verif">
      <BarreParcours libelle="Saisie des budgets" onRetour={onRetour} desactive={envoi.cours}>
        <Etapes parcours="budgets" actuelle={2} />
      </BarreParcours>
      <h2 className="bandeau-titre">VÉRIFICATION AVANT ENREGISTREMENT — BUDGETS {periode.toUpperCase()}</h2>
      <div className="saisie-synthese" role="status">
        <section aria-label="Budgets">
          <h3>Budgets ({n})</h3>
          <ul>
            <li><Badge ton="succes">{verif.ajouts.length}</Badge> nouveau{verif.ajouts.length > 1 ? 'x' : ''}</li>
            <li><Badge ton="alerte">{verif.modifs.length}</Badge> modifié{verif.modifs.length > 1 ? 's' : ''}</li>
            <li><Badge ton={verif.effaces.length ? 'erreur' : 'neutre'}>{verif.effaces.length}</Badge> effacé{verif.effaces.length > 1 ? 's' : ''}</li>
          </ul>
        </section>
        <section aria-label="Totaux">
          <h3>Totaux (FCFA)</h3>
          <ul>
            {AXES.map((a) => (
              <li key={a}>
                {TITRES[a]} : {egaux(verif.totaux[a].avant, verif.totaux[a].apres)
                  ? <strong>{fcfa(verif.totaux[a].apres)}</strong>
                  : <>{fcfa(verif.totaux[a].avant)} → <strong>{fcfa(verif.totaux[a].apres)}</strong></>}
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Contrôles">
          <h3>Contrôles</h3>
          <ul>
            <li><Badge ton="succes">0</Badge> erreur</li>
            <li><Badge ton={verif.points.length ? 'alerte' : 'succes'}>{verif.points.length}</Badge> point{verif.points.length > 1 ? 's' : ''} d’attention</li>
          </ul>
        </section>
      </div>
      {verif.effaces.length > 0 && (
        <p className="bandeau ko" role="alert">
          {pluriel(verif.effaces.length, 'budget enregistré sera effacé', 'budgets enregistrés seront effacés')} (cellule vidée).
        </p>
      )}
      <div className="panneau">
        <div className="panneau-corps" role="region" aria-label="Détail de la vérification">
          {verif.points.map((p) => (
            <details key={p.code} className="section" open>
              <summary>
                <span className="section-titre">{p.titre} ({p.lignes.length})</span>
                <span className="note">{p.aide}</span>
              </summary>
              <ul className="saisie-points">{p.lignes.map((l) => <li key={l}>{l}</li>)}</ul>
            </details>
          ))}
          <details className="section" open={verif.points.length === 0}>
            <summary><span className="section-titre">Changements ({n})</span></summary>
            <table className="dense">
              <thead>
                <tr>
                  <th scope="col">Répartition</th>
                  <th scope="col">Ligne</th>
                  <th scope="col" className="num">Avant</th>
                  <th scope="col" className="num">Après</th>
                </tr>
              </thead>
              <tbody>
                {changements.map((c) => (
                  <tr key={`${c.axe}:${c.cible_id}`}>
                    <td>{TITRES[c.axe]}</td>
                    <th scope="row">{c.libelle}</th>
                    <td className="num">{fcfa(c.avant)}</td>
                    <td className="num">{c.apres == null ? <Badge ton="erreur">effacé</Badge> : fcfa(c.apres)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      </div>
      <div className="saisie-pied">
        {envoi.erreur && <span className="champ-erreur" role="alert">{envoi.erreur}</span>}
        <Bouton onClick={onEnregistrer} disabled={envoi.cours || n === 0}>
          {envoi.cours ? 'Enregistrement…' : `Enregistrer ${pluriel(n, 'budget')}`}
        </Bouton>
      </div>
    </section>
  )
}

const egaux = (a: string | null, b: string | null) => a === b
