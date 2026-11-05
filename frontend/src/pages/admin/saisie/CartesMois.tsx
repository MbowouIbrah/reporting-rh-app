import type { ReactNode } from 'react'
import { AXES, TITRES, usePilotage, useSaisies, type Groupe } from '../../../api/pilotage'
import { usePeut } from '../../../auth/AuthContext'
import Etat, { etatErreur } from '../../../components/Etat'
import { fcfa, MOIS, pct } from '../../../lib/format'
import ConflitsSaisie from './ConflitsSaisie'
import { COURT, MONTANTS } from './SaisieDonnees'

const GROUPES: { id: Groupe; titre: string; action: string; marge: boolean }[] = [
  { id: 'ca_marge', titre: 'Résultats financiers', action: 'les résultats financiers', marge: true },
  { id: 'activite', titre: 'Résultats d’activité', action: 'les résultats d’activité', marge: false },
  { id: 'obj_ca_marge', titre: 'Objectifs financiers', action: 'les objectifs financiers', marge: true },
  { id: 'obj_activite', titre: 'Objectifs d’activité', action: 'les objectifs d’activité', marge: false },
]

/** Le titre de la carte dit déjà « Objectifs » : « Objectif CA » devient « CA ». */
const libelle = (ind: string) => {
  const l = (COURT[ind] ?? ind).replace(/^Objectif /, '')
  return l.charAt(0).toUpperCase() + l.slice(1)
}

interface Props {
  annee: number
  mois: number
  periode: string
  onBudgets: () => void
  onDonnees: (groupe: Groupe) => void
}

/** Petite carte cliquable : le bouton couvre toute la carte, son libellé reste le nom accessible. */
function Tuile({ titre, action, onClick, children }: { titre: string; action: string; onClick: () => void; children: ReactNode }) {
  return (
    <article className="saisie-tuile">
      <h4>{titre}</h4>
      <div className="saisie-tuile-corps">{children}</div>
      <button type="button" className="saisie-tuile-action" onClick={onClick}>{action} →</button>
    </article>
  )
}

function TuileGroupe({ g, annee, mois, periode, onClick }: { g: (typeof GROUPES)[number]; annee: number; mois: number; periode: string; onClick: () => void }) {
  const vue = useSaisies(g.id, annee, mois, true)
  const action = `Saisir ${g.action} de ${periode}`
  return (
    <Tuile titre={g.titre} action={action} onClick={onClick}>
      {vue.data ? (
        <>
        <dl>
          {vue.data.indicateurs.map((ind) => {
            const t = vue.data.totaux[ind]
            return (
              <div key={ind}>
                <dt>{libelle(ind)}</dt>
                <dd>
                  {t?.valeur == null ? '—' : `${fcfa(t.valeur)}${MONTANTS.has(ind) ? ' FCFA' : ''}`}
                  {t?.partiel && t.renseignes > 0 && <span className="note"> ({t.renseignes} sur {t.attendus})</span>}
                </dd>
              </div>
            )
          })}
          {vue.data.taux_marge !== undefined && (
            <div><dt>Taux de marge</dt><dd>{pct(vue.data.taux_marge)}</dd></div>
          )}
        </dl>
        {!vue.isPlaceholderData && <ConflitsSaisie vue={vue.data} max={2} />}
        </>
      ) : (
        <Etat type={vue.isError ? etatErreur(vue.error) : 'chargement'} onRetry={() => vue.refetch()} />
      )}
    </Tuile>
  )
}

/** Rangée de cartes du mois : total et état de chaque groupe de données et des budgets, chacune ouvre sa saisie. */
export default function CartesMois({ annee, mois, periode, onBudgets, onDonnees }: Props) {
  const avecLecture = usePeut('import:read')
  const avecMarge = usePeut('marge:read')
  const pilotage = usePilotage(annee, mois, true)
  const groupes = avecLecture ? GROUPES.filter((g) => !g.marge || avecMarge) : []
  return (
    <div className="saisie-tuiles">
      {groupes.map((g) => (
        <TuileGroupe key={g.id} g={g} annee={annee} mois={mois} periode={periode} onClick={() => onDonnees(g.id)} />
      ))}
      <Tuile titre="Budgets" action={`Saisir les budgets de ${periode}`} onClick={onBudgets}>
        {pilotage.data ? (
          <dl>
            {AXES.map((axe) => {
              const liste = pilotage.data.budgets[axe]
              const n = liste.filter((x) => x.valeur !== null).length
              const total = pilotage.data.totaux[axe]
              return (
                <div key={axe}>
                  <dt>{TITRES[axe]}</dt>
                  <dd>{total == null ? '—' : `${fcfa(total)} FCFA`}{n > 0 && <span className="note"> ({n} sur {liste.length})</span>}</dd>
                </div>
              )
            })}
          </dl>
        ) : null}
        {pilotage.data?.reprise && (
          <p className="note">
            Aucun budget pour {periode} : ceux de {MOIS[pilotage.data.reprise.mois - 1]} {pilotage.data.reprise.annee} pourront servir de point de départ.
          </p>
        )}
        {!pilotage.data && (
          <Etat type={pilotage.isError ? etatErreur(pilotage.error) : 'chargement'} onRetry={() => pilotage.refetch()} />
        )}
      </Tuile>
    </div>
  )
}
