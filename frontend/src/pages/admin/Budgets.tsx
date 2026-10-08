import { useState } from 'react'
import {
  useBudgets,
  useCopierBudgets,
  usePeriodesAdmin,
  useSaisirBudgets,
  type AxeBudget,
  type BudgetsVue,
} from '../../api/admin'
import { Bouton, Carte, Champ, ChampMontant, Confirmer } from '../../components/Kit'
import AdminNav from '../../components/AdminNav'
import Etat from '../../components/Etat'
import { MOIS_COURTS as MOIS, montantValide } from '../../lib/format'

const AXES: { axe: AxeBudget; titre: string }[] = [
  { axe: 'rubrique', titre: 'Par rubrique (global uniquement)' },
  { axe: 'service', titre: 'Par service' },
  { axe: 'site', titre: 'Par site' },
]
const cle = (axe: AxeBudget, id: number) => `${axe}:${id}`

function Saisie({ vue }: { vue: BudgetsVue }) {
  const saisir = useSaisirBudgets()
  const initial = Object.fromEntries(
    AXES.flatMap(({ axe }) => vue.lignes[axe].map((l) => [cle(axe, l.cible_id), l.valeur ?? ''])),
  )
  const [vals, setVals] = useState<Record<string, string>>(initial)
  const [err, setErr] = useState<string | null>(null)
  const close = vue.statut === 'close'

  const enregistrer = () => {
    const lignes = AXES.flatMap(({ axe }) =>
      vue.lignes[axe].flatMap((l) => {
        const v = (vals[cle(axe, l.cible_id)] ?? '').trim()
        if (v === (initial[cle(axe, l.cible_id)] ?? '')) return []
        return [{ axe, cible_id: l.cible_id, valeur: v || null }]
      }),
    )
    if (lignes.some((l) => l.valeur && !montantValide(l.valeur))) return setErr('Montant invalide (chiffres, 3 décimales max)')
    setErr(null)
    saisir.mutate({ id: vue.periode_id, lignes }, { onError: (e) => setErr(e.message) })
  }

  return (
    <>
      {AXES.map(({ axe, titre }) => (
        <Carte key={axe} titre={titre}>
          {vue.lignes[axe].map((l) =>
            close ? (
              <p key={l.cible_id}>
                {l.libelle} : {l.valeur ?? '—'}
              </p>
            ) : (
              <ChampMontant
                key={l.cible_id}
                label={`${titre} : ${l.libelle}`}
                valeur={vals[cle(axe, l.cible_id)] ?? ''}
                onChange={(v) => setVals({ ...vals, [cle(axe, l.cible_id)]: v })}
              />
            ),
          )}
        </Carte>
      ))}
      {err && (
        <p className="champ-erreur" role="alert">
          {err}
        </p>
      )}
      {close ? (
        <p className="note">Période close : saisie verrouillée.</p>
      ) : (
        <Bouton onClick={enregistrer} disabled={saisir.isPending}>
          Enregistrer les budgets
        </Bouton>
      )}
      <p className="note">Le budget total reste calculé : budget par employé × effectif.</p>
    </>
  )
}

export default function Budgets({ periodeId }: { periodeId?: number } = {}) {
  const periodes = usePeriodesAdmin()
  const copier = useCopierBudgets()
  const [choisi, setPid] = useState<number | null>(null)
  const pid = periodeId ?? choisi
  const [source, setSource] = useState('')
  const [confirmer, setConfirmer] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const vue = useBudgets(pid)

  if (periodes.isLoading) return <Etat type="chargement" />
  if (periodes.isError) return <Etat type="erreur" onRetry={() => periodes.refetch()} />
  const liste = [...(periodes.data ?? [])].reverse()
  const nom = (p: { annee: number; mois: number }) => `${MOIS[p.mois - 1]} ${p.annee}`

  const lancer = () => {
    if (pid === null) return
    copier.mutate(
      { id: pid, depuis: Number(source) },
      { onSuccess: () => setConfirmer(false), onError: (e) => setErr(e.message) },
    )
  }

  return (
    <>
      {periodeId === undefined && <AdminNav />}
      {periodeId === undefined && <h2>Budgets mensuels</h2>}
      {periodeId === undefined && (
      <Champ label="Période">
        {(p) => (
          <select {...p} value={pid ?? ''} onChange={(e) => setPid(e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {liste.map((x) => (
              <option key={x.id} value={x.id}>
                {nom(x)}
              </option>
            ))}
          </select>
        )}
      </Champ>
      )}
      {pid !== null && vue.isLoading && <Etat type="chargement" />}
      {pid !== null && vue.isError && <Etat type="erreur" onRetry={() => vue.refetch()} />}
      {vue.data && pid !== null && (
        <>
          {vue.data.statut !== 'close' && (
            <>
              <Champ label="Copier depuis">
                {(p) => (
                  <select {...p} value={source} onChange={(e) => setSource(e.target.value)}>
                    <option value="">—</option>
                    {liste
                      .filter((x) => x.id !== pid)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {nom(x)}
                        </option>
                      ))}
                  </select>
                )}
              </Champ>
              <Bouton variante="secondaire" disabled={!source} onClick={() => setConfirmer(true)}>
                Copier
              </Bouton>
            </>
          )}
          <Saisie key={`${pid}-${JSON.stringify(vue.data.lignes)}`} vue={vue.data} />
        </>
      )}
      <Confirmer
        ouvert={confirmer}
        titre="Copier les budgets"
        confirmer="Copier"
        onConfirmer={lancer}
        onAnnuler={() => {
          setConfirmer(false)
          setErr(null)
        }}
      >
        <p>
          Les budgets de la période sont remplacés par ceux de la source.
          {err && <span className="champ-erreur"> {err}</span>}
        </p>
      </Confirmer>
    </>
  )
}
