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

/** Titre d'une page de rapport, avec le bouton d'export à sa droite.
 *  `onGraphiques` (page Graphes) : le menu propose aussi les graphiques dynamiques. */
export function TitreRapport({ titre, onGraphiques }: { titre: string; onGraphiques?: () => void }) {
  return (
    <div className="titre-rapport">
      <h2 className="bandeau-titre">{titre}</h2>
      <ExportPdf onGraphiques={onGraphiques} />
    </div>
  )
}

/** Bouton d'export : menu déroulant du choix des parties, puis le rapport s'ouvre dans un onglet prêt à enregistrer en PDF.
 *  Avec `onGraphiques`, le menu propose d'abord deux choix : graphiques dynamiques (sélection à l'écran) ou résumé PDF. */
export default function ExportPdf({ onGraphiques }: { onGraphiques?: () => void } = {}) {
  const { can } = useAuth()
  const { pathname } = useLocation()
  const [ouvert, setOuvert] = useState(false)
  const [etape, setEtape] = useState<'choix' | 'pdf'>('pdf')
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
          if (!ouvert) {
            setChoix([courante.id])
            setEtape(onGraphiques ? 'choix' : 'pdf')
          }
          setOuvert((o) => !o)
        }}
      >
        <FileDown aria-hidden="true" size={16} />
        {onGraphiques ? 'Exporter' : 'Exporter en PDF'}
      </button>
      {ouvert && onGraphiques && etape === 'choix' && (
        <div id="export-menu" className="export-menu export-types" role="group" aria-label="Type d’export">
          <button
            type="button"
            className="export-type"
            onClick={() => {
              setOuvert(false)
              onGraphiques()
            }}
          >
            <strong>Graphiques dynamiques (réutilisables)</strong>
            <span>Excel : chaque graphe reste modifiable, même collé dans PowerPoint.</span>
          </button>
          <button type="button" className="export-type" onClick={() => setEtape('pdf')}>
            <strong>Budget réalisé PDF</strong>
            <span>Les parties du rapport choisies, prêtes à imprimer.</span>
          </button>
        </div>
      )}
      {ouvert && etape === 'pdf' && (
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
