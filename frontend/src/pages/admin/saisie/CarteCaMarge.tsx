import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apresEcriture, enregistrerCaMarge, type Pilotage } from '../../../api/pilotage'
import { Bouton, Carte, ChampMontant } from '../../../components/Kit'
import { enMilli, fcfa, montantSigneValide, montantValide, pct, sansEspaces, valeurBrute } from '../../../lib/format'

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
  // Points d'attention, non bloquants : relus avant d'enregistrer, comme à la vérification des données.
  const alertes: string[] = []
  if (modifie && !errCa && !errMarge && !caVide) {
    const dec = (v: string) => enMilli(sansEspaces(v).replace(',', '.'))
    const vCa = dec(ca), vMarge = margeVide ? null : dec(marge)
    if (vMarge != null && vMarge > vCa) alertes.push('La marge dépasse le CA : taux de marge supérieur à 100 %.')
    if (vCa === 0n) alertes.push('CA à zéro : laisser vide s’il n’est pas encore connu.')
    const avant = vue.ca == null ? null : enMilli(vue.ca)
    if (avant != null && avant > 0n && ca !== initial.ca) {
      const d = vCa - avant
      if ((d < 0n ? -d : d) * 2n > avant) alertes.push(`Écart de plus de 50 % sur le CA enregistré (${fcfa(vue.ca)} FCFA) : un zéro en trop ou en moins ?`)
    }
  }
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
      {alertes.length > 0 && (
        <ul className="pilotage-alertes" aria-label="Points d’attention">{alertes.map((a) => <li key={a}>{a}</li>)}</ul>
      )}
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
