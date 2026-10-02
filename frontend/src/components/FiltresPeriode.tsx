import type { FiltresPage } from '../api/rapports'
import { MOIS } from '../lib/format'

interface Props {
  filtres: FiltresPage
  annees: number[]
  services?: string[]
  sites?: string[]
  avecMois?: boolean
  onChange: (patch: Record<string, string | number | undefined>) => void
}

export default function FiltresPeriode({ filtres, annees, services, sites, avecMois = true, onChange }: Props) {
  return (
    <div className="filtres" role="group" aria-label="Filtres">
      <label>
        Année
        <select value={filtres.annee} onChange={(e) => onChange({ annee: e.target.value, mois: undefined })}>
          {annees.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </label>
      {avecMois && (
        <label>
          Mois
          <select value={filtres.mois} onChange={(e) => onChange({ mois: e.target.value })}>
            {MOIS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}
      {services && (
        <label>
          Service
          <select value={filtres.service ?? ''} onChange={(e) => onChange({ service: e.target.value })}>
            <option value="">Tous</option>
            {services.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      {sites && (
        <label>
          Site
          <select value={filtres.site ?? ''} onChange={(e) => onChange({ site: e.target.value })}>
            <option value="">Tous</option>
            {sites.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      {(filtres.service || filtres.site) && (
        <button
          type="button"
          className="bouton bouton-lien"
          onClick={() => onChange({ service: undefined, site: undefined })}
        >
          Réinitialiser
        </button>
      )}
      <p className="filtres-resume" aria-live="polite">
        {[avecMois ? MOIS[filtres.mois - 1] : null, String(filtres.annee), filtres.site, filtres.service]
          .filter(Boolean)
          .map((t) => (
            <span key={t} className="puce">
              {t}
            </span>
          ))}
      </p>
    </div>
  )
}
