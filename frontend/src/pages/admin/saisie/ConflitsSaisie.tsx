import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apresSaisies, reglerConflit, type ValeurSaisie, type VueSaisies } from '../../../api/pilotage'
import { usePeut } from '../../../auth/AuthContext'
import { Bouton } from '../../../components/Kit'
import { montantExact } from '../../../lib/format'

const NOMS: Record<string, string> = { ca: 'CA', marge: 'Marge' }

function libelleCase(vue: VueSaisies, site: number | null, service: number | null) {
  const noms = [
    vue.sites.find((s) => s.id === site)?.libelle,
    vue.services.find((s) => s.id === service)?.libelle,
  ].filter(Boolean)
  return noms.length > 0 ? noms.join(' — ') : 'Global'
}

interface Props {
  vue: VueSaisies
  max?: number
  /** Grille modifiée et non enregistrée : un choix rechargerait la vue et perdrait la saisie. */
  bloque?: boolean
  /** Appelé avant l'envoi : supprimer la dernière ligne ne doit pas changer le niveau affiché. */
  avantChoix?: () => void
}

/** Cases où la saisie et la somme des employés diffèrent : les deux chiffres, celui qui est retenu, et le choix en un clic. */
export default function ConflitsSaisie({ vue, max, bloque = false, avantChoix }: Props) {
  const qc = useQueryClient()
  const peutChoisir = usePeut('saisie:write')
  const [envoi, setEnvoi] = useState<string | null>(null)
  const [erreur, setErreur] = useState('')

  const conflits = vue.cases.flatMap((c) =>
    vue.indicateurs.filter((i) => c.valeurs[i]?.conflit).map((i) => ({ c, i, v: c.valeurs[i] })),
  )
  // Choix refusé parce que le conflit a disparu : la raison reste lisible.
  if (conflits.length === 0) return erreur ? <p className="champ-erreur" role="alert">{erreur}</p> : null
  const montres = max === undefined ? conflits : conflits.slice(0, max)

  const choisir = async (cle: string, site: number | null, service: number | null, ind: string, v: ValeurSaisie, choix: 'saisie' | 'employes') => {
    setEnvoi(cle)
    setErreur('')
    avantChoix?.()
    try {
      apresSaisies(qc, await reglerConflit(vue.annee, vue.mois, site, service, ind, choix, v.saisi, v.employes))
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Choix impossible.')
      // Refus : les chiffres ont pu changer, l'écran doit montrer ceux du serveur.
      qc.invalidateQueries({ queryKey: ['saisies', vue.groupe, vue.annee, vue.mois] })
    } finally {
      setEnvoi(null)
    }
  }

  return (
    <section className="saisie-conflits" aria-label="Conflits entre la saisie et les employés">
      <h5><span role="status">{conflits.length > 1 ? `${conflits.length} conflits` : '1 conflit'} avec les employés</span></h5>
      <ul>
        {montres.map(({ c, i, v }) => {
          const cle = `${c.site_id}|${c.service_id}|${i}`
          const nom = `${NOMS[i] ?? i}, ${libelleCase(vue, c.site_id, c.service_id)}`
          return (
            <li key={cle}>
              <p><strong>{nom}</strong></p>
              <p>Saisie : {montantExact(v.saisi)} FCFA · Employés : {montantExact(v.employes)} FCFA</p>
              <p>{v.origine === 'calcule' ? 'La somme des employés est retenue : elle a changé après la saisie.' : 'La saisie est retenue : aucun changement plus récent côté employés.'}</p>
              {peutChoisir && (
                <div className="saisie-conflit-choix">
                  <Bouton variante="secondaire" disabled={envoi !== null || bloque} aria-label={`Garder la saisie : ${nom}`} onClick={() => void choisir(cle, c.site_id, c.service_id, i, v, 'saisie')}>
                    Garder la saisie
                  </Bouton>
                  <Bouton variante="secondaire" disabled={envoi !== null || bloque} aria-label={`Prendre la somme des employés : ${nom}`} onClick={() => void choisir(cle, c.site_id, c.service_id, i, v, 'employes')}>
                    Prendre la somme des employés
                  </Bouton>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {conflits.length > montres.length && <p>Et {conflits.length - montres.length} autre{conflits.length - montres.length > 1 ? 's' : ''} : ouvrez la saisie.</p>}
      {peutChoisir && bloque && <p className="note">Enregistrez d’abord vos modifications pour choisir.</p>}
      {erreur && <p className="champ-erreur" role="alert">{erreur}</p>}
    </section>
  )
}
