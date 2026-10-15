import { useEffect, useMemo, useRef, useState } from 'react'
import type { Preparation, SalariePrepa } from '../../../api/saisie'
import BoutonReinitialiser from '../../../components/BoutonReinitialiser'
import { Badge, Bouton } from '../../../components/Kit'
import { matriculeAffiche, MOIS } from '../../../lib/format'
import BarreParcours from './BarreParcours'
import type { Brouillon } from './brouillon'
import Etapes from './Etapes'
import { lignesSelection, versApi } from './GrilleSaisie'
import LienModele from './LienModele'

const sansAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Cochés par défaut : les employés pas encore saisis pour ce mois. */
export const selectionDefaut = (p: Preparation) => p.salaries.filter((s) => !s.saisi).map((s) => s.matricule)

function CaseGroupe({ etat, onChange, libelle }: { etat: 'tous' | 'aucun' | 'partiel'; onChange: (v: boolean) => void; libelle: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = etat === 'partiel' }, [etat])
  return <input ref={ref} type="checkbox" checked={etat === 'tous'} onChange={(e) => onChange(e.target.checked)} aria-label={libelle} />
}

interface Props {
  prepa: Preparation
  selection: string[]
  brouillon: Brouillon | null
  onValider: (matricules: string[]) => void
  onReprendre: () => void
  onOublier: () => void
  onRetour: () => void
}

export default function ChoixEmployes({ prepa, selection, brouillon, onValider, onReprendre, onOublier, onRetour }: Props) {
  const [coches, setCoches] = useState(() => new Set(selection))
  const [recherche, setRecherche] = useState('')
  const q = sansAccents(recherche.trim())
  const visibles = useMemo(
    () => prepa.salaries.filter((s) => !q || sansAccents(`${s.nom} ${s.matricule}`).includes(q)),
    [prepa, q],
  )
  const groupes = useMemo(() => {
    const m = new Map<string, SalariePrepa[]>()
    for (const s of visibles) {
      const g = s.attributs.service ?? 'Sans service'
      m.set(g, [...(m.get(g) ?? []), s])
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, 'fr'))
  }, [visibles])

  const basculer = (mats: string[], v: boolean) =>
    setCoches((c) => {
      const n = new Set(c)
      for (const m of mats) (v ? n.add(m) : n.delete(m))
      return n
    })
  const tous = visibles.map((s) => s.matricule)
  // Ordre de la liste conservé dans la grille.
  const choisis = prepa.salaries.filter((s) => coches.has(s.matricule)).map((s) => s.matricule)
  const periode = `${MOIS[prepa.mois - 1]} ${prepa.annee}`
  const moisPrecedent = MOIS[(prepa.mois + 10) % 12]
  const rubriques = prepa.rubriques.map((r) => r.libelle)

  return (
    <section className="page-ecran rapport-excel saisie-choix">
      <BarreParcours libelle="Choix du mois" onRetour={onRetour}>
        <Etapes parcours="grille" actuelle={1} />
      </BarreParcours>
      <h2 className="bandeau-titre">EMPLOYÉS CONCERNÉS — {periode.toUpperCase()}</h2>
      {brouillon && (
        <p className="bandeau ko" role="status">
          <span>
            Une saisie non enregistrée existe pour ce mois ({brouillon.lignes.length} ligne{brouillon.lignes.length > 1 ? 's' : ''}) :
            elle sera reprise dans la grille.
          </span>
          <Bouton variante="secondaire" onClick={onReprendre}>Reprendre cette saisie</Bouton>
          <button type="button" className="bouton bouton-lien" onClick={onOublier}>L’abandonner</button>
        </p>
      )}
      <div className="filtres" role="group" aria-label="Sélection">
        <label>
          Rechercher
          <input type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Nom ou matricule" />
        </label>
        <BoutonReinitialiser actif={recherche !== ''} onClick={() => setRecherche('')} libelle="Effacer la recherche" />
        <Bouton variante="secondaire" onClick={() => basculer(tous, true)}>Tout cocher</Bouton>
        <Bouton variante="secondaire" onClick={() => basculer(tous, false)}>Tout décocher</Bouton>
        <span className="saisie-compte" role="status">{choisis.length} / {prepa.salaries.length} sélectionné{choisis.length > 1 ? 's' : ''}</span>
      </div>
      <div className="panneau">
        <div className="panneau-corps" role="region" aria-label="Employés">
          {prepa.salaries.length === 0 ? (
            <p className="etat">Aucun employé répertorié : continuez, puis ajoutez des lignes dans la grille.</p>
          ) : visibles.length === 0 ? (
            <p className="etat">Aucun employé ne correspond à « {recherche} ».</p>
          ) : (
            <table className="dense saisie-liste">
              <thead>
                <tr>
                  <th scope="col" className="saisie-case"><span className="sr-only">Sélection</span></th>
                  <th scope="col">Employé</th>
                  <th scope="col">Matricule</th>
                  <th scope="col">Poste</th>
                  <th scope="col">Remarque</th>
                </tr>
              </thead>
              {groupes.map(([g, liste]) => {
                const n = liste.filter((s) => coches.has(s.matricule)).length
                const etat = n === 0 ? 'aucun' : n === liste.length ? 'tous' : 'partiel'
                return (
                  <tbody key={g}>
                    <tr className="saisie-service">
                      <th scope="colgroup" colSpan={5}>
                        <label>
                          <CaseGroupe etat={etat} libelle={`Tout le service ${g}`} onChange={(v) => basculer(liste.map((s) => s.matricule), v)} />
                          Service {g}
                          <span className="note">{n} coché{n > 1 ? 's' : ''} sur {liste.length}</span>
                        </label>
                      </th>
                    </tr>
                    {liste.map((s) => {
                      const id = `choix-${s.matricule}`
                      const coche = coches.has(s.matricule)
                      return (
                        <tr
                          key={s.matricule}
                          className={coche ? 'cochee' : undefined}
                          // Toute la ligne est cliquable ; la case et son libellé gèrent déjà leur clic.
                          onClick={(e) => { if (!(e.target as HTMLElement).closest('input, label')) basculer([s.matricule], !coche) }}
                        >
                          <td className="saisie-case">
                            <input id={id} type="checkbox" checked={coche} onChange={(e) => basculer([s.matricule], e.target.checked)} />
                          </td>
                          <td><label htmlFor={id} className="saisie-nom">{s.nom}</label></td>
                          <td>{matriculeAffiche(s.matricule) || <span className="note">Sans matricule</span>}</td>
                          <td>{s.attributs.poste ?? ''}</td>
                          <td>
                            {s.saisi && <Badge ton="info">Déjà saisi pour ce mois</Badge>}
                            {!s.present_precedent && <Badge ton="alerte">Absent en {moisPrecedent}</Badge>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                )
              })}
            </table>
          )}
        </div>
      </div>
      <div className="saisie-pied">
        <LienModele annee={prepa.annee} mois={prepa.mois} title={choisis.length ? undefined : 'Aucun employé coché : modèle vide'}
          lignes={() => lignesSelection(prepa, choisis, brouillon?.lignes).map((l) => versApi(l, rubriques))}>
          Remplir plutôt dans Excel (modèle des employés cochés)
        </LienModele>
        <Bouton onClick={() => onValider(choisis)}>
          Continuer : saisir les montants ({choisis.length}) →
        </Bouton>
      </div>
    </section>
  )
}
