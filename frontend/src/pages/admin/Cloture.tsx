import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useOuvrirMois, useParcours, type EtapeParcours, type Parcours, type StatutEtape } from '../../api/donnees'
import { useSaisirCa } from '../../api/admin'
import AdminNav from '../../components/AdminNav'
import Etat from '../../components/Etat'
import { Badge, Bouton, Carte, ChampMontant } from '../../components/Kit'
import { MOIS } from '../../lib/format'
import Budgets from './Budgets'
import DonneesMensuelles from './DonneesMensuelles'

const STATUTS: Record<StatutEtape, { texte: string; ton: 'succes' | 'alerte' | 'neutre' | 'info' }> = {
  fait: { texte: 'Fait', ton: 'succes' },
  a_faire: { texte: 'À faire', ton: 'info' },
  a_revoir: { texte: 'À revoir', ton: 'alerte' },
  reportable: { texte: 'Peut attendre', ton: 'neutre' },
  facultatif: { texte: 'Facultatif', ton: 'neutre' },
}
const montant = (v: string) => /^\d+([.,]\d{0,3})?$/.test(v.trim())

function Ouvrir({ annee, mois }: { annee: number; mois: number }) {
  const ouvrir = useOuvrirMois()
  return (
    <Carte titre="Ce mois n’est pas encore ouvert">
      <p>L’ouvrir permet de saisir le chiffre d’affaires et les budgets avant même les données de paie.</p>
      <Bouton onClick={() => ouvrir.mutate({ annee, mois })} disabled={ouvrir.isPending}>
        Ouvrir {MOIS[mois - 1].toLowerCase()} {annee}
      </Bouton>
      {ouvrir.isError && (
        <p className="champ-erreur" role="alert">
          {ouvrir.error.message}
        </p>
      )}
    </Carte>
  )
}

function Liste({ titre, gens }: { titre: string; gens: { matricule: string; nom: string }[] }) {
  return (
    <div>
      <h4>
        {titre} ({gens.length})
      </h4>
      {gens.length === 0 ? (
        <p className="note">Aucun.</p>
      ) : (
        <ul>
          {gens.map((g) => (
            <li key={g.matricule}>
              {g.matricule} · {g.nom}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Controles({ p, etape }: { p: Parcours; etape: EtapeParcours }) {
  const s = STATUTS[etape.statut]
  return (
    <div className="duo">
      <Carte titre="Contrôles">
        <p>
          <Badge ton={s.ton}>{s.texte}</Badge> {etape.resume}
        </p>
      </Carte>
      <Carte titre={`Effectif : ${p.effectifs.total} employés`}>
        <p className="note">Présent ce mois-ci mais pas le précédent : entrée. L’inverse : départ.</p>
        <Liste titre="Entrées" gens={p.effectifs.entrees} />
        <Liste titre="Départs" gens={p.effectifs.sorties} />
      </Carte>
    </div>
  )
}

function Ca({ id, ca }: { id: number; ca: string | null }) {
  const saisir = useSaisirCa()
  const [val, setVal] = useState(ca ? String(Number(ca)) : '')
  const [err, setErr] = useState<string | null>(null)
  const enregistrer = () => {
    const v = val.trim()
    if (v && !montant(v)) return setErr('Montant invalide (chiffres, 3 décimales max)')
    setErr(null)
    saisir.mutate({ id, valeur: v || null }, { onError: (e) => setErr(e.message) })
  }
  return (
    <Carte titre="Chiffre d’affaires du mois">
      <ChampMontant label="Chiffre d’affaires" valeur={val} onChange={setVal} erreur={err} />
      <Bouton onClick={enregistrer} disabled={saisir.isPending}>
        Enregistrer
      </Bouton>
      <p className="note">Peut être saisi à tout moment, y compris après les données.</p>
    </Carte>
  )
}

export default function Cloture() {
  const [params, setParams] = useSearchParams()
  const now = new Date()
  const [a, m] = (params.get('periode') ?? '').split('-').map(Number)
  const annee = a || now.getFullYear()
  const mois = m >= 1 && m <= 12 ? m : now.getMonth() + 1
  const cle = params.get('etape') ?? 'donnees'
  const q = useParcours(annee, mois)
  const aller = (periode: string, etape: string) => setParams({ periode, etape }, { replace: true })
  const per = (y: number, mo: number) => `${y}-${String(mo).padStart(2, '0')}`

  const p = q.data
  const sansMois = p && p.periode_id === null

  return (
    <>
      <AdminNav />
      <h2>Fin de mois</h2>
      <div className="filtres">
        <label>
          Mois
          <select value={mois} onChange={(e) => aller(per(annee, Number(e.target.value)), cle)}>
            {MOIS.map((x, i) => (
              <option key={x} value={i + 1}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label>
          Année
          <select value={annee} onChange={(e) => aller(per(Number(e.target.value), mois), cle)}>
            {[annee - 1, annee, annee + 1].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
      </div>
      {q.isLoading && <Etat type="chargement" />}
      {q.isError && <Etat type="erreur" onRetry={() => q.refetch()} />}
      {p && (
        <>
          <nav aria-label="Étapes du mois" className="stepper">
            {p.etapes.map((e, i) => {
              const s = STATUTS[e.statut]
              return (
                <button
                  key={e.cle}
                  type="button"
                  className={`pastille${e.cle === cle ? ' active' : ''}`}
                  aria-current={e.cle === cle ? 'step' : undefined}
                  onClick={() => aller(per(annee, mois), e.cle)}
                >
                  <span className="pastille-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="pastille-texte">
                    <strong>{e.libelle}</strong>
                    <Badge ton={s.ton}>{s.texte}</Badge>
                  </span>
                </button>
              )
            })}
          </nav>
          <div className="contenu-etape">
            {cle === 'mois' &&
              (sansMois ? (
                <Ouvrir annee={annee} mois={mois} />
              ) : (
                <Carte titre={`${MOIS[mois - 1]} ${annee}`}>
                  <p>Ce mois est ouvert : chaque étape reste modifiable à tout moment.</p>
                </Carte>
              ))}
            {cle === 'donnees' && <DonneesMensuelles periode={{ annee, mois }} />}
            {cle === 'controles' && <Controles p={p} etape={p.etapes[2]} />}
            {cle === 'ca' &&
              (sansMois ? <Ouvrir annee={annee} mois={mois} /> : <Ca key={`${annee}-${mois}`} id={p.periode_id!} ca={p.ca} />)}
            {cle === 'budgets' &&
              (sansMois ? <Ouvrir annee={annee} mois={mois} /> : <Budgets periodeId={p.periode_id!} />)}
          </div>
        </>
      )}
    </>
  )
}
