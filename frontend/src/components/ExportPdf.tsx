import { FileDown } from 'lucide-react'
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { lirePartage } from '../lib/filtresPartages'
import { sectionsPermises } from '../lib/sectionsRapport'
import { Confirmer } from './Kit'

/** Adresse du rapport à imprimer : parties choisies et filtres en cours. */
export function urlRapport(sections: string[], filtres: Record<string, string | undefined>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(filtres)) if (v) p.set(k, v)
  p.set('sections', sections.join(','))
  return `${import.meta.env.BASE_URL}rapport?${p}`
}

/** Bouton de la barre : choix des parties, puis le rapport s'ouvre dans un onglet prêt à enregistrer en PDF. */
export default function ExportPdf() {
  const { can } = useAuth()
  const { pathname } = useLocation()
  const [ouvert, setOuvert] = useState(false)
  const [choix, setChoix] = useState<string[]>([])
  const dispo = sectionsPermises(can)
  const courante = dispo.find((s) => pathname.startsWith(s.route))
  if (!courante) return null
  const tout = choix.length === dispo.length

  function exporter() {
    window.open(urlRapport(dispo.filter((s) => choix.includes(s.id)).map((s) => s.id), lirePartage()), '_blank')
    setOuvert(false)
  }

  return (
    <div className="export-pdf">
      <button
        type="button"
        className="export-bouton"
        onClick={() => {
          setChoix([courante.id])
          setOuvert(true)
        }}
      >
        <FileDown aria-hidden="true" size={16} />
        Exporter en PDF
      </button>
      <Confirmer
        ouvert={ouvert}
        titre="Exporter en PDF"
        confirmer="Exporter"
        desactive={choix.length === 0}
        onConfirmer={exporter}
        onAnnuler={() => setOuvert(false)}
      >
        <p className="export-aide">Parties à inclure, avec les filtres en cours :</p>
        <fieldset className="export-choix">
          <legend className="sr-only">Parties du rapport</legend>
          {dispo.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={choix.includes(s.id)}
                onChange={(e) => setChoix((c) => (e.target.checked ? [...c, s.id] : c.filter((x) => x !== s.id)))}
              />
              {s.libelle}
            </label>
          ))}
        </fieldset>
        <button type="button" className="btn-link" onClick={() => setChoix(tout ? [] : dispo.map((s) => s.id))}>
          {tout ? 'Tout désélectionner' : 'Tout le rapport'}
        </button>
      </Confirmer>
    </div>
  )
}
