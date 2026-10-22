import { useState } from 'react'

function Oeil({ ouvert }: { ouvert: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      {ouvert ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="M1 1l22 22" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  )
}

type Props = {
  id: string
  libelle: string
  valeur: string
  onChange: (v: string) => void
  autoComplete: string
  desactive?: boolean
}

/** Champ mot de passe avec bouton œil (afficher / masquer). */
export default function ChampMotDePasse({ id, libelle, valeur, onChange, autoComplete, desactive }: Props) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="field">
      <label htmlFor={id}>{libelle}</label>
      <div className="login-input-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={valeur}
          onChange={(e) => onChange(e.target.value)}
          disabled={desactive}
        />
        <button
          type="button"
          className="login-input-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          aria-pressed={visible}
          disabled={desactive}
        >
          <Oeil ouvert={visible} />
        </button>
      </div>
    </div>
  )
}
