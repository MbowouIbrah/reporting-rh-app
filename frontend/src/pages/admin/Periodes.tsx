import { useState } from 'react'
import { useCloturer, usePeriodesAdmin, useRouvrir, useSaisirCa, type PeriodeAdmin } from '../../api/admin'
import { Badge, Bouton, Carte, Champ, ChampMontant, Confirmer } from '../../components/Kit'
import Etat from '../../components/Etat'

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const montant = (v: string) => /^\d+([.,]\d{0,3})?$/.test(v.trim())

function Ligne({ p, onCloturer, onRouvrir }: { p: PeriodeAdmin; onCloturer: () => void; onRouvrir: () => void }) {
  const saisir = useSaisirCa()
  const [val, setVal] = useState(p.ca ?? '')
  const [err, setErr] = useState<string | null>(null)
  const close = p.statut === 'close'
  const modifie = val.trim() !== (p.ca ?? '')

  const enregistrer = () => {
    const v = val.trim()
    if (v && !montant(v)) return setErr('Montant invalide (chiffres, 3 décimales max)')
    setErr(null)
    saisir.mutate({ id: p.id, valeur: v || null }, { onError: (e) => setErr(e.message) })
  }

  return (
    <Carte
      titre={
        <>
          {MOIS[p.mois - 1]} {p.annee}
          <Badge ton={close ? 'neutre' : 'succes'}>{close ? 'Close' : 'Ouverte'}</Badge>
        </>
      }
      actions={
        close ? (
          <Bouton variante="secondaire" onClick={onRouvrir}>
            Rouvrir
          </Bouton>
        ) : (
          <Bouton variante="secondaire" onClick={onCloturer}>
            Clôturer
          </Bouton>
        )
      }
    >
      <ChampMontant label="Chiffre d’affaires" valeur={val} onChange={setVal} erreur={err} />
      {!close && (
        <Bouton onClick={enregistrer} disabled={!modifie || saisir.isPending}>
          Enregistrer
        </Bouton>
      )}
      {close && <p className="note">Période close : saisie verrouillée.</p>}
    </Carte>
  )
}

export default function Periodes() {
  const q = usePeriodesAdmin()
  const cloturer = useCloturer()
  const rouvrir = useRouvrir()
  const [cible, setCible] = useState<{ p: PeriodeAdmin; action: 'cloturer' | 'rouvrir' } | null>(null)
  const [motif, setMotif] = useState('')
  const [err, setErr] = useState<string | null>(null)

  if (q.isLoading) return <Etat type="chargement" />
  if (q.isError) return <Etat type="erreur" onRetry={() => q.refetch()} />

  const fermer = () => {
    setCible(null)
    setMotif('')
    setErr(null)
  }
  const confirmer = () => {
    if (!cible) return
    const opts = { onSuccess: fermer, onError: (e: Error) => setErr(e.message) }
    if (cible.action === 'cloturer') cloturer.mutate(cible.p.id, opts)
    else rouvrir.mutate({ id: cible.p.id, motif: motif.trim() }, opts)
  }
  const reouv = cible?.action === 'rouvrir'

  return (
    <>
      <h2>Périodes et chiffre d’affaires</h2>
      {[...(q.data ?? [])].reverse().map((p) => (
        <Ligne
          key={`${p.id}-${p.ca}-${p.statut}`}
          p={p}
          onCloturer={() => setCible({ p, action: 'cloturer' })}
          onRouvrir={() => setCible({ p, action: 'rouvrir' })}
        />
      ))}
      <Confirmer
        ouvert={!!cible}
        titre={reouv ? 'Rouvrir la période' : 'Clôturer la période'}
        confirmer={reouv ? 'Rouvrir' : 'Clôturer'}
        desactive={reouv && motif.trim().length < 5}
        onConfirmer={confirmer}
        onAnnuler={fermer}
      >
        {reouv ? (
          <Champ label="Motif (5 caractères minimum)" erreur={err}>
            {(p) => <input {...p} value={motif} onChange={(e) => setMotif(e.target.value)} />}
          </Champ>
        ) : (
          <p>Les écritures de cette période seront verrouillées.{err && <span className="champ-erreur"> {err}</span>}</p>
        )}
      </Confirmer>
    </>
  )
}
