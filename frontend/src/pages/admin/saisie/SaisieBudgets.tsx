import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apresEcriture, AXES, enregistrerBudgets, TITRES, type Axe, type LigneBudget, type Pilotage } from '../../../api/pilotage'
import { Bouton, Confirmer } from '../../../components/Kit'
import { fcfa, MOIS, montantValide, sansEspaces, somme, valeurBrute } from '../../../lib/format'
import BarreParcours from './BarreParcours'

type Valeurs = Record<string, string>
const cle = (axe: Axe, id: number) => `${axe}:${id}`
const decimal = (v: string) => sansEspaces(v).replace(',', '.')

function valeursDe(vue: Pilotage): Valeurs {
  const v: Valeurs = {}
  for (const axe of AXES) for (const x of vue.budgets[axe]) v[cle(axe, x.cible_id)] = valeurBrute(x.valeur ?? undefined)
  return v
}

/** Budgets du mois en trois tableaux (type de charge, service, site), comme les colonnes Budget du MENSUEL. */
export default function SaisieBudgets({ vue, periode, onRetour }: { vue: Pilotage; periode: string; onRetour: () => void }) {
  const qc = useQueryClient()
  const [base, setBase] = useState(() => valeursDe(vue))
  const [valeurs, setValeurs] = useState(base)
  const [envoi, setEnvoi] = useState<{ cours: boolean; erreur?: string; ok?: boolean }>({ cours: false })
  const [quitter, setQuitter] = useState(false)

  const invalide = (k: string) => !!valeurs[k].trim() && !montantValide(sansEspaces(valeurs[k]))
  const modifiees = Object.keys(valeurs).filter((k) => valeurs[k] !== base[k])
  const nbInvalides = Object.keys(valeurs).filter(invalide).length
  const vide = Object.values(valeurs).every((v) => !v.trim())
  const reprise = vue.reprise

  const changer = (k: string, v: string) => {
    setValeurs((p) => ({ ...p, [k]: v }))
    setEnvoi({ cours: false })
  }

  const reprendre = () => {
    if (!reprise) return
    setValeurs((p) => {
      const n = { ...p }
      for (const axe of AXES) {
        for (const [id, v] of Object.entries(reprise.valeurs[axe])) if (cle(axe, Number(id)) in n) n[cle(axe, Number(id))] = valeurBrute(v)
      }
      return n
    })
    setEnvoi({ cours: false })
  }

  const enregistrer = async () => {
    setEnvoi({ cours: true })
    const lignes: LigneBudget[] = modifiees.map((k) => {
      const [axe, id] = k.split(':')
      return { axe: axe as Axe, cible_id: Number(id), valeur: valeurs[k].trim() ? sansEspaces(valeurs[k]) : null }
    })
    try {
      const v = await enregistrerBudgets(vue.annee, vue.mois, lignes)
      apresEcriture(qc, v)
      const n = valeursDe(v)
      setBase(n)
      setValeurs(n)
      setEnvoi({ cours: false, ok: true })
    } catch (e) {
      setEnvoi({ cours: false, erreur: e instanceof Error ? e.message : 'Enregistrement impossible.' })
    }
  }

  const retour = () => (modifiees.length ? setQuitter(true) : onRetour())

  return (
    <section className="page-ecran rapport-excel saisie-budgets">
      <BarreParcours libelle="Choix du mois" onRetour={retour} />
      <h2 className="bandeau-titre">BUDGETS — {periode.toUpperCase()}</h2>
      {reprise && vide && (
        <p className="bandeau" role="status">
          <span>
            Aucun budget pour {periode}. Ceux de {MOIS[reprise.mois - 1]} {reprise.annee} peuvent servir de point de départ ;
            rien n’est enregistré avant « Enregistrer ».
          </span>
          <Bouton variante="secondaire" className="bandeau-action" onClick={reprendre}>
            Reprendre les budgets de {MOIS[reprise.mois - 1]}
          </Bouton>
        </p>
      )}
      <div className="budgets-grille">
        {AXES.map((axe) => {
          // Rubriques exclues du TOTAL CHARGES en fin de tableau, hors total, comme dans DONNEES.
          const liste = [...vue.budgets[axe].filter((x) => !x.exclue), ...vue.budgets[axe].filter((x) => x.exclue)]
          const comptees = liste.filter((x) => !x.exclue)
          // Un montant invalide rend le total inconnu plutôt que faux.
          const total = comptees.some((x) => invalide(cle(axe, x.cible_id)))
            ? null
            : somme(comptees.map((x) => valeurs[cle(axe, x.cible_id)].trim() ? decimal(valeurs[cle(axe, x.cible_id)]) : null))
          return (
            <div className="panneau" key={axe}>
              <div className="panneau-corps">
                <table className="dense budgets">
                  <caption className="sr-only">Budgets par {TITRES[axe].toLowerCase()}, {periode}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{TITRES[axe]}</th>
                      <th scope="col" className="num">Budget (FCFA)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liste.map((x, i) => {
                      const k = cle(axe, x.cible_id)
                      const ko = invalide(k)
                      const debutExclues = x.exclue && (i === 0 || !liste[i - 1].exclue)
                      return (
                        <tr key={k} className={[x.exclue && 'exclu', debutExclues && 'exclu-debut'].filter(Boolean).join(' ') || undefined}>
                          <th scope="row">
                            {x.libelle}
                            {!x.actif && <span className="note"> (inactif)</span>}
                            {x.exclue && <span className="exclu-mention">hors total</span>}
                          </th>
                          <td className={ko ? 'num ko' : 'num'}>
                            <input
                              type="text"
                              inputMode="decimal"
                              aria-label={`Budget ${x.libelle} (${TITRES[axe].toLowerCase()})`}
                              aria-invalid={ko || undefined}
                              value={valeurs[k]}
                              onChange={(e) => changer(k, e.target.value)}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="total">
                      <th scope="row">TOTAL</th>
                      <td className="num">{fcfa(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )
        })}
      </div>
      <div className="saisie-pied">
        <span className="note">
          {nbInvalides > 0
            ? `${nbInvalides} montant${nbInvalides > 1 ? 's' : ''} invalide${nbInvalides > 1 ? 's' : ''} : chiffres, virgule et 3 décimales au plus.`
            : modifiees.length
              ? `${modifiees.length} budget${modifiees.length > 1 ? 's' : ''} modifié${modifiees.length > 1 ? 's' : ''}, non enregistré${modifiees.length > 1 ? 's' : ''}.`
              : envoi.ok ? 'Budgets enregistrés.' : 'Aucune modification.'}
        </span>
        {/* Seul l'enregistrement est annoncé, pas chaque frappe. */}
        <span className="sr-only" role="status">{envoi.ok && !modifiees.length ? 'Enregistrement terminé.' : ''}</span>
        {envoi.erreur && <p className="champ-erreur" role="alert">{envoi.erreur}</p>}
        <Bouton onClick={enregistrer} disabled={!modifiees.length || nbInvalides > 0 || envoi.cours}>
          {envoi.cours ? 'Enregistrement…' : 'Enregistrer les budgets'}
        </Bouton>
      </div>
      <Confirmer
        ouvert={quitter}
        titre="Quitter sans enregistrer ?"
        confirmer="Quitter"
        onConfirmer={() => { setQuitter(false); onRetour() }}
        onAnnuler={() => setQuitter(false)}
      >
        <p>{modifiees.length} budget{modifiees.length > 1 ? 's' : ''} modifié{modifiees.length > 1 ? 's' : ''} {modifiees.length > 1 ? 'seront perdus' : 'sera perdu'}.</p>
      </Confirmer>
    </section>
  )
}
