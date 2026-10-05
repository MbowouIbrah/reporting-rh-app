import { useState } from 'react'
import {
  useCreerParametre,
  useCreerRegle,
  useCreerRubrique,
  useModifierRubrique,
  useParametrage,
  useTerminerRegle,
  type Parametrage as Donnees,
} from '../../api/admin'
import { Badge, Bouton, Carte, Champ } from '../../components/Kit'
import AdminNav from '../../components/AdminNav'
import Etat from '../../components/Etat'

const LIBELLE_CLE = { jours_ouvres: 'Jours ouvrés par mois', budget_employe: 'Budget par employé (FCFA)' }
const LIBELLE_REGLE = { exclu_total_ligne: 'Exclue du total de ligne', exclu_total_general: 'Exclue du total général' }
const nombre = (v: string) => /^\d+([.,]\d{0,3})?$/.test(v.trim())
const dateIso = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)

function Parametres({ d }: { d: Donnees }) {
  const creer = useCreerParametre()
  const [cle, setCle] = useState('jours_ouvres')
  const [valeur, setValeur] = useState('')
  const [debut, setDebut] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const ajouter = () => {
    if (!nombre(valeur)) return setErr('Valeur invalide')
    if (!dateIso(debut)) return setErr('Date de début invalide')
    setErr(null)
    creer.mutate(
      { cle, valeur, date_debut: debut },
      { onSuccess: () => setValeur(''), onError: (e) => setErr(e.message) },
    )
  }

  return (
    <Carte titre="Paramètres datés">
      <ul>
        {d.parametres.map((p) => (
          <li key={p.id}>
            {LIBELLE_CLE[p.cle]} : <strong>{p.valeur}</strong> depuis le {p.date_debut}
          </li>
        ))}
      </ul>
      <p className="note">Une valeur n’est jamais modifiée : on en ajoute une plus récente.</p>
      <Champ label="Paramètre">
        {(p) => (
          <select {...p} value={cle} onChange={(e) => setCle(e.target.value)}>
            <option value="jours_ouvres">{LIBELLE_CLE.jours_ouvres}</option>
            <option value="budget_employe">{LIBELLE_CLE.budget_employe}</option>
          </select>
        )}
      </Champ>
      <Champ label="Nouvelle valeur">
        {(p) => <input {...p} inputMode="decimal" value={valeur} onChange={(e) => setValeur(e.target.value)} />}
      </Champ>
      <Champ label="À partir du" erreur={err}>
        {(p) => <input {...p} type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />}
      </Champ>
      <Bouton onClick={ajouter} disabled={creer.isPending}>
        Ajouter la valeur
      </Bouton>
    </Carte>
  )
}

function Regles({ d }: { d: Donnees }) {
  const creer = useCreerRegle()
  const terminer = useTerminerRegle()
  const [rub, setRub] = useState('')
  const [regle, setRegle] = useState('exclu_total_ligne')
  const [debut, setDebut] = useState('')
  const [fins, setFins] = useState<Record<number, string>>({})
  const [err, setErr] = useState<string | null>(null)
  const nom = (id: number) => d.rubriques.find((r) => r.id === id)?.libelle ?? `#${id}`

  const ajouter = () => {
    if (!rub) return setErr('Choisir une rubrique')
    if (!dateIso(debut)) return setErr('Date de début invalide')
    setErr(null)
    creer.mutate({ rubrique_id: Number(rub), regle, date_debut: debut }, { onError: (e) => setErr(e.message) })
  }
  const finir = (id: number) => {
    const f = fins[id] ?? ''
    if (!dateIso(f)) return setErr('Date de fin invalide')
    setErr(null)
    terminer.mutate({ id, date_fin: f }, { onError: (e) => setErr(e.message) })
  }

  return (
    <Carte titre="Règles d’exclusion">
      <ul>
        {d.regles.map((r) => (
          <li key={r.id}>
            {nom(r.rubrique_id)} : {LIBELLE_REGLE[r.regle]}, du {r.date_debut}
            {r.date_fin ? ` au ${r.date_fin}` : ' (en cours)'}
            {!r.date_fin && (
              <>
                {' '}
                <Champ label={`Date de fin, ${nom(r.rubrique_id)}`}>
                  {(p) => (
                    <input
                      {...p}
                      type="date"
                      value={fins[r.id] ?? ''}
                      onChange={(e) => setFins({ ...fins, [r.id]: e.target.value })}
                    />
                  )}
                </Champ>
                <Bouton variante="secondaire" onClick={() => finir(r.id)} disabled={terminer.isPending}>
                  Terminer
                </Bouton>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="note">Une règle existante n’est jamais modifiée : on la termine, puis on crée la suivante.</p>
      <Champ label="Rubrique">
        {(p) => (
          <select {...p} value={rub} onChange={(e) => setRub(e.target.value)}>
            <option value="">—</option>
            {d.rubriques.map((r) => (
              <option key={r.id} value={r.id}>
                {r.libelle}
              </option>
            ))}
          </select>
        )}
      </Champ>
      <Champ label="Règle">
        {(p) => (
          <select {...p} value={regle} onChange={(e) => setRegle(e.target.value)}>
            <option value="exclu_total_ligne">{LIBELLE_REGLE.exclu_total_ligne}</option>
            <option value="exclu_total_general">{LIBELLE_REGLE.exclu_total_general}</option>
          </select>
        )}
      </Champ>
      <Champ label="Règle à partir du" erreur={err}>
        {(p) => <input {...p} type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />}
      </Champ>
      <Bouton onClick={ajouter} disabled={creer.isPending}>
        Ajouter la règle
      </Bouton>
    </Carte>
  )
}

function Rubriques({ d }: { d: Donnees }) {
  const creer = useCreerRubrique()
  const modifier = useModifierRubrique()
  const [libelle, setLibelle] = useState('')
  const [unite, setUnite] = useState('FCFA')
  const [err, setErr] = useState<string | null>(null)

  const ajouter = () => {
    if (!libelle.trim()) return setErr('Libellé vide')
    setErr(null)
    creer.mutate(
      { libelle: libelle.trim(), unite },
      { onSuccess: () => setLibelle(''), onError: (e) => setErr(e.message) },
    )
  }

  return (
    <Carte titre="Rubriques">
      <ul>
        {d.rubriques.map((r) => (
          <li key={r.id}>
            {r.libelle} ({r.unite}) {r.moteur && <Badge>Moteur KPI</Badge>}
            <Badge ton={r.actif ? 'succes' : 'neutre'}>{r.actif ? 'Active' : 'Inactive'}</Badge>
            {!r.moteur && (
              <Bouton
                variante="secondaire"
                onClick={() => modifier.mutate({ id: r.id, actif: !r.actif }, { onError: (e) => setErr(e.message) })}
              >
                {r.actif ? 'Désactiver' : 'Activer'}
              </Bouton>
            )}
          </li>
        ))}
      </ul>
      <Champ label="Nouvelle rubrique">
        {(p) => <input {...p} value={libelle} onChange={(e) => setLibelle(e.target.value)} />}
      </Champ>
      <Champ label="Unité" erreur={err}>
        {(p) => (
          <select {...p} value={unite} onChange={(e) => setUnite(e.target.value)}>
            <option value="FCFA">FCFA</option>
            <option value="jours">jours</option>
          </select>
        )}
      </Champ>
      <Bouton onClick={ajouter} disabled={creer.isPending}>
        Ajouter la rubrique
      </Bouton>
    </Carte>
  )
}

export default function Parametrage() {
  const q = useParametrage()
  if (q.isLoading) return <Etat type="chargement" />
  if (q.isError || !q.data) return <Etat type="erreur" onRetry={() => q.refetch()} />
  return (
    <>
      <AdminNav />
      <h2>Paramétrage</h2>
      <div className="trio">
        <Parametres d={q.data} />
        <Regles d={q.data} />
        <Rubriques d={q.data} />
      </div>
    </>
  )
}
