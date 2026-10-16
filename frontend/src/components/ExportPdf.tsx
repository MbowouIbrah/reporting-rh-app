import { FileDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { lirePartage } from '../lib/filtresPartages'
import { sectionsPermises } from '../lib/sectionsRapport'

/** Adresse du rapport à imprimer : parties choisies et filtres en cours. */
export function urlRapport(sections: string[], filtres: Record<string, string | undefined>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(filtres)) if (v) p.set(k, v)
  p.set('sections', sections.join(','))
  return `${import.meta.env.BASE_URL}rapport?${p}`
}

/** Largeur proche de la zone imprimable A4 paysage (277 mm ≈ 1047 px) : mêmes règles CSS à l'écran qu'au papier. */
const LARGEUR_IMPRESSION = 'popup,width=1080,height=900'

/** Titre d'une page de rapport, avec le bouton d'export à sa droite. */
export function TitreRapport({ titre }: { titre: string }) {
  return (
    <div className="titre-rapport">
      <h2 className="bandeau-titre">{titre}</h2>
      <ExportPdf />
    </div>
  )
}

/** Bouton d'export : menu déroulant du choix des parties, puis le rapport s'ouvre dans un onglet prêt à enregistrer en PDF. */
export default function ExportPdf() {
  const { can } = useAuth()
  const { pathname } = useLocation()
  const [ouvert, setOuvert] = useState(false)
  const [choix, setChoix] = useState<string[]>([])
  const zone = useRef<HTMLDivElement>(null)
  const bouton = useRef<HTMLButtonElement>(null)
  const dispo = sectionsPermises(can)
  const courante = dispo.find((s) => pathname.startsWith(s.route))

  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: PointerEvent) => {
      if (!zone.current?.contains(e.target as Node)) setOuvert(false)
    }
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOuvert(false)
        bouton.current?.focus()
      }
    }
    document.addEventListener('pointerdown', dehors)
    document.addEventListener('keydown', touche)
    return () => {
      document.removeEventListener('pointerdown', dehors)
      document.removeEventListener('keydown', touche)
    }
  }, [ouvert])

  if (!courante) return null
  const tout = choix.length === dispo.length

  function exporter() {
    // Fenêtre à la largeur de la page imprimée : l'aperçu se met en page comme le PDF, ses blocs y sont ajustés juste
    window.open(urlRapport(dispo.filter((s) => choix.includes(s.id)).map((s) => s.id), lirePartage()), 'rapport-rh', LARGEUR_IMPRESSION)
    setOuvert(false)
  }

  return (
    <div className="export-pdf" ref={zone}>
      <button
        ref={bouton}
        type="button"
        className="export-bouton"
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-controls="export-menu"
        onClick={() => {
          if (!ouvert) setChoix([courante.id])
          setOuvert((o) => !o)
        }}
      >
        <FileDown aria-hidden="true" size={16} />
        Exporter en PDF
      </button>
      {ouvert && (
        <div id="export-menu" className="export-menu">
          <fieldset className="export-choix">
            <legend>Parties à inclure, avec les filtres en cours</legend>
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
          <div className="export-actions">
            <button type="button" className="btn-link" onClick={() => setChoix(tout ? [] : dispo.map((s) => s.id))}>
              {tout ? 'Tout désélectionner' : 'Tout le rapport'}
            </button>
            <button type="button" className="bouton bouton-primaire" disabled={choix.length === 0} onClick={exporter}>
              Exporter
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
