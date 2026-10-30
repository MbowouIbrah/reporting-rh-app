import { useEffect, useId, useRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode, RefObject } from 'react'

type Ton = 'neutre' | 'succes' | 'alerte' | 'erreur' | 'info'

/** Pastille de statut : le texte porte le sens, la couleur renforce. */
export function Badge({ ton = 'neutre', children }: { ton?: Ton; children: ReactNode }) {
  return <span className={`badge badge-${ton}`}>{children}</span>
}

export function Bouton({
  variante = 'primaire',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primaire' | 'secondaire' | 'lien' }) {
  return <button type="button" className={`bouton bouton-${variante} ${className ?? ''}`.trim()} {...rest} />
}

/** Choix d'un fichier : vrai bouton (atteignable au clavier) qui ouvre le sélecteur caché. */
export function ChoixFichier({
  libelle,
  accept,
  inputRef,
  onFichier,
  variante = 'secondaire',
}: {
  libelle: string
  variante?: 'primaire' | 'secondaire' | 'lien'
  accept: string
  inputRef: RefObject<HTMLInputElement | null>
  onFichier: (f: File | undefined) => void
}) {
  return (
    <>
      <Bouton variante={variante} onClick={() => inputRef.current?.click()}>
        {libelle}
      </Bouton>
      <input ref={inputRef} type="file" accept={accept} hidden tabIndex={-1} aria-hidden="true" onChange={(e) => onFichier(e.target.files?.[0])} />
    </>
  )
}

export function Carte({ titre, children, actions }: { titre?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="carte">
      {(titre || actions) && (
        <header className="carte-entete">
          {titre && <h3>{titre}</h3>}
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

/** Section repliable native (clavier et lecteurs d'écran gérés par <details>). */
export function Section({
  titre,
  resume,
  ouverte = true,
  children,
}: {
  titre: string
  resume?: ReactNode
  ouverte?: boolean
  children: ReactNode
}) {
  return (
    <details className="section" open={ouverte}>
      <summary>
        <span className="section-titre">{titre}</span>
        {resume && <span className="note">{resume}</span>}
      </summary>
      <div className="section-corps">{children}</div>
    </details>
  )
}

/** Champ de formulaire : étiquette liée, erreur annoncée, aria-invalid. */
export function Champ({
  label,
  erreur,
  children,
}: {
  label: string
  erreur?: string | null
  children: (p: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode
}) {
  const id = useId()
  const errId = `${id}-err`
  return (
    <div className="champ">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': !!erreur, 'aria-describedby': erreur ? errId : undefined })}
      {erreur && (
        <p id={errId} className="champ-erreur" role="alert">
          {erreur}
        </p>
      )}
    </div>
  )
}

/** Montant saisi : toujours une chaîne (jamais float), virgule ou point acceptés. */
export function ChampMontant({
  label,
  valeur,
  onChange,
  erreur,
}: {
  label: string
  valeur: string
  onChange: (v: string) => void
  erreur?: string | null
}) {
  return (
    <Champ label={label} erreur={erreur}>
      {(p) => (
        <input {...p} type="text" inputMode="decimal" value={valeur} onChange={(e) => onChange(e.target.value)} />
      )}
    </Champ>
  )
}

/** Confirmation modale native (<dialog>), focus géré par le navigateur. */
export function Confirmer({
  ouvert,
  titre,
  children,
  confirmer = 'Confirmer',
  desactive,
  onConfirmer,
  onAnnuler,
}: {
  ouvert: boolean
  titre: string
  children?: ReactNode
  confirmer?: string
  desactive?: boolean
  onConfirmer: () => void
  onAnnuler: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const idTitre = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (ouvert && !d.open) d.showModal?.() ?? d.setAttribute('open', '')
    if (!ouvert && d.open) d.close?.() ?? d.removeAttribute('open')
  }, [ouvert])
  return (
    <dialog ref={ref} className="confirmer" aria-labelledby={idTitre} onCancel={onAnnuler}>
      <h3 id={idTitre}>{titre}</h3>
      {children}
      <div className="confirmer-actions">
        <Bouton variante="secondaire" onClick={onAnnuler}>
          Annuler
        </Bouton>
        <Bouton onClick={onConfirmer} disabled={desactive}>
          {confirmer}
        </Bouton>
      </div>
    </dialog>
  )
}
