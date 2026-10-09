import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apresEcriture, enregistrerCaMarge, type Pilotage } from '../../../api/pilotage'
import { Bouton, Carte, ChampMontant } from '../../../components/Kit'
import { montantSigneValide, montantValide, pct, sansEspaces, valeurBrute } from '../../../lib/format'

const INVALIDE = 'Montant invalide : chiffres, virgule et 3 décimales au plus.'

/** CA et marge du mois, saisis ensemble comme dans l'Excel ; le taux est calculé par le serveur. */
export default function CarteCaMarge({ vue, periode }: { vue: Pilotage; periode: string }) {
  const qc = useQueryClient()
  const initial = { ca: valeurBrute(vue.ca ?? undefined), marge: valeurBrute(vue.marge ?? undefined) }
  const [ca, setCa] = useState(initial.ca)
  const [marge, setMarge] = useState(initial.marge)
  const [envoi, setEnvoi] = useState<{ cours: boolean; erreur?: string; ok?: boolean }>({ cours: false })

  const caVide = !ca.trim()
  const margeVide = !marge.trim()
  const errCa = !caVide && !montantValide(sansEspaces(ca)) ? `${INVALIDE} Le CA ne peut pas être négatif.` : null
  const errMarge = !margeVide && !montantSigneValide(marge)
    ? INVALIDE
    : !margeVide && caVide ? 'Saisissez le CA du mois avant la marge.' : null
  const modifie = ca !== initial.ca || marge !== initial.marge
  const changer = (set: (v: string) => void) => (v: string) => { set(v); setEnvoi({ cours: false }) }

  const enregistrer = async () => {
    setEnvoi({ cours: true })
    try {
      const v = await enregistrerCaMarge(vue.annee, vue.mois, caVide ? null : sansEspaces(ca), margeVide ? null : sansEspaces(marge))
      apresEcriture(qc, v)
      setCa(valeurBrute(v.ca ?? undefined))
      setMarge(valeurBrute(v.marge ?? undefined))
      setEnvoi({ cours: false, ok: true })
    } catch (e) {
      setEnvoi({ cours: false, erreur: e instanceof Error ? e.message : 'Enregistrement impossible.' })
    }
  }

  return (
    <Carte titre="Chiffre d’affaires et marge">
      <p className="note">Montants globaux de {periode} en FCFA. La marge peut être négative ; elle n’est acceptée qu’avec un CA.</p>
      <div className="pilotage-champs">
        <ChampMontant label="Chiffre d’affaires" valeur={ca} onChange={changer(setCa)} erreur={errCa} />
        <ChampMontant label="Marge" valeur={marge} onChange={changer(setMarge)} erreur={errMarge} />
      </div>
      <p className="pilotage-taux">
        <span>Taux de marge enregistré</span>
        <strong>{vue.taux_marge == null ? '—' : pct(vue.taux_marge)}</strong>
      </p>
      <div className="saisie-carte-action">
        <Bouton onClick={enregistrer} disabled={!modifie || !!errCa || !!errMarge || envoi.cours}>
          {envoi.cours ? 'Enregistrement…' : 'Enregistrer le CA et la marge'}
        </Bouton>
        {envoi.erreur && <p className="champ-erreur" role="alert">{envoi.erreur}</p>}
        <p className="note" role="status">{envoi.ok && !modifie ? 'Enregistré.' : ''}</p>
      </div>
    </Carte>
  )
}
