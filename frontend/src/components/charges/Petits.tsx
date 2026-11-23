import type { ReactNode } from 'react'
import { type Evo, type Rang, type Sens, fleche, fp, grouper, sensPc } from '../../lib/charges'

/** Flèche de sens ; la couleur n'est mise que si elle porte un message (hausse de coût, écart fort). */
export function Fl({ s, couleur = true }: { s: Sens; couleur?: boolean }) {
  return <span aria-hidden="true" className={couleur && s ? s : undefined}>{fleche(s)}</span>
}

/** Écart en valeur, flèche et pourcentage, à droite du grand chiffre. */
export function EvoCase({ e }: { e: Evo }) {
  const c = (e.couleur ?? true) && e.sens ? ` ${e.sens}` : ''
  return (
    <>
      <span className="ecart">{e.ecart}</span>
      <span className={`fle evo${c}`}><Fl s={e.sens} couleur={false} /></span>
      <span className={`evo${c}`}>{e.txt}</span>
    </>
  )
}

/** Ligne sous le grand chiffre : information discrète à gauche, évolution à droite. */
export function Sous({ g, children }: { g: ReactNode; children?: ReactNode }) {
  return (
    <p className="sous">
      <span className="g">{g}</span>
      {children ? <span className="d">{children}</span> : null}
    </p>
  )
}

export const SansDonnees = () => <i>pas de données</i>

/** Note commune aux cartes et aux tableaux : la période comparée a moins de mois de données que la période choisie. */
export const NotePartielle = () => (
  <p className="partiel">Comparaison partielle : la période comparée compte moins de mois de données que la période choisie.</p>
)

/** Trois lignes d'une carte : les deux plus gros, puis la plus forte évolution. */
export function ListeRangs({ rows }: { rows: Rang[] }) {
  return (
    <div className="top3">
      {grouper(rows).map(({ motif, fort, rangs }) => (
        <div className="grp" key={motif}>
          {motif !== 'poids' && <p className="motif">{fort ? 'Forte' : 'Plus forte'} {motif}</p>}
          <ol>
            {rangs.map((x) => (
              <li key={x.nom} className={motif === 'poids' ? '' : fort ? `alerte ${motif}` : 'remarque'} title={x.titre}>
                <span className="nom">{x.nom}</span>
                <span className="mt">{x.val}</span>
                {x.e == null ? (
                  <>
                    <span className="fle" />
                    <span className="ev">—</span>
                  </>
                ) : (
                  <>
                    <span className="fle"><Fl s={sensPc(x.e)} couleur={false} /></span>
                    <span className="ev">{x.evTxt ?? fp(x.e)}</span>
                  </>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}
