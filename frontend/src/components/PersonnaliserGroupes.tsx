import { ArrowDown, ArrowUp } from 'lucide-react'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import {
  type ConfigGroupes, descGroupe, GRAPHES, type Groupe, MAX_NOM, MAX_PAR_GROUPE, nouvelId, retablirOrigine, tousLesGroupes, VUE_TOUT,
} from '../lib/groupesGraphes'

/** Le groupe d'ouverture doit être affiché : sinon il passe au premier groupe affiché. */
function normaliser(c: ConfigGroupes): ConfigGroupes {
  if (c.defaut === VUE_TOUT || c.ordre.includes(c.defaut)) return c
  return { ...c, defaut: c.ordre[0] ?? VUE_TOUT }
}

interface Edition {
  /** null : nouveau groupe. */
  id: string | null
  nom: string
  graphes: string[]
}

/**
 * Fenêtre « Personnaliser » : on travaille sur une copie du réglage, appliquée seulement par « Enregistrer ».
 * Affichée dès qu'elle est montée ; `dispo` : identifiants des graphiques qui ont des données.
 */
export default function PersonnaliserGroupes({ config, dispo, onEnregistrer, onAnnuler }: {
  config: ConfigGroupes
  dispo: Set<string>
  onEnregistrer: (c: ConfigGroupes) => void
  onAnnuler: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const idTitre = useId()
  const [travail, setTravail] = useState<ConfigGroupes>(config)
  const [edition, setEdition] = useState<Edition | null>(null)
  useEffect(() => {
    const d = ref.current
    if (!d || d.open) return
    if (d.showModal) d.showModal()
    else d.setAttribute('open', '')
  }, [])

  const parId = new Map(tousLesGroupes(travail).map((g) => [g.id, g]))
  const affiches = [...new Set(travail.ordre)].filter((id) => parId.has(id))
  const masques = tousLesGroupes(travail).filter((g) => !affiches.includes(g.id))
  const lignes: Groupe[] = [...affiches.map((id) => parId.get(id)!), ...masques]
  const maj = (c: ConfigGroupes) => setTravail(normaliser(c))

  const basculer = (id: string) =>
    maj({ ...travail, ordre: affiches.includes(id) ? affiches.filter((x) => x !== id) : [...affiches, id] })
  const deplacer = (id: string, sens: -1 | 1) => {
    const i = affiches.indexOf(id)
    const j = i + sens
    if (i < 0 || j < 0 || j >= affiches.length) return
    const o = [...affiches]
    ;[o[i], o[j]] = [o[j], o[i]]
    maj({ ...travail, ordre: o })
  }
  const supprimer = (id: string) =>
    maj({ ...travail, perso: travail.perso.filter((g) => g.id !== id), ordre: affiches.filter((x) => x !== id) })
  const seulementMesGroupes = () => maj({ ...travail, ordre: travail.perso.map((g) => g.id) })
  const retablir = () => maj(retablirOrigine(travail))

  const valider = (e: FormEvent) => {
    e.preventDefault()
    if (!edition) return
    const nom = edition.nom.trim()
    if (!nom || !edition.graphes.length) return
    const groupe: Groupe = { id: edition.id ?? nouvelId(), nom, graphes: edition.graphes }
    if (edition.id) maj({ ...travail, perso: travail.perso.map((g) => (g.id === groupe.id ? groupe : g)) })
    else maj({ ...travail, perso: [...travail.perso, groupe], ordre: [...affiches, groupe.id] })
    setEdition(null)
  }
  const cocher = (id: string) => {
    if (!edition) return
    const sel = edition.graphes.includes(id) ? edition.graphes.filter((x) => x !== id) : [...edition.graphes, id]
    setEdition({ ...edition, graphes: sel })
  }

  const choixGraphes = edition ? GRAPHES.filter((g) => dispo.has(g.id) || edition.graphes.includes(g.id)) : []
  const plein = !!edition && edition.graphes.length >= MAX_PAR_GROUPE
  const nomValide = !!edition && edition.nom.trim().length > 0

  return (
    <dialog ref={ref} className="perso-groupes" aria-labelledby={idTitre} onCancel={onAnnuler}>
      <h3 id={idTitre}>Personnaliser les groupes</h3>
      <p className="perso-aide">Choisissez les groupes affichés, leur ordre et celui qui s’ouvre en premier.</p>
      <ul className="perso-liste">
        {lignes.map((g) => {
          const affiche = affiches.includes(g.id)
          const i = affiches.indexOf(g.id)
          const perso = travail.perso.some((p) => p.id === g.id)
          return (
            <li key={g.id} className={affiche ? undefined : 'masque'}>
              <input type="checkbox" checked={affiche} aria-label={`Afficher ${g.nom}`} onChange={() => basculer(g.id)} />
              <span className="perso-texte">
                <strong>{g.nom}</strong>
                <small>{descGroupe(g)}</small>
              </span>
              <span className="perso-actions">
                <button type="button" className="perso-icone" aria-label={`Monter ${g.nom}`} disabled={!affiche || i === 0} onClick={() => deplacer(g.id, -1)}>
                  <ArrowUp aria-hidden="true" size={16} />
                </button>
                <button type="button" className="perso-icone" aria-label={`Descendre ${g.nom}`} disabled={!affiche || i === affiches.length - 1} onClick={() => deplacer(g.id, 1)}>
                  <ArrowDown aria-hidden="true" size={16} />
                </button>
                <label className="perso-defaut">
                  <input
                    type="radio"
                    name="defaut"
                    aria-label={`Ouvrir sur ${g.nom}`}
                    checked={travail.defaut === g.id}
                    disabled={!affiche}
                    onChange={() => maj({ ...travail, defaut: g.id })}
                  />
                  par défaut
                </label>
                {perso && (
                  <>
                    <button type="button" className="bouton bouton-lien" onClick={() => setEdition({ id: g.id, nom: g.nom, graphes: [...g.graphes] })}>
                      Modifier
                    </button>
                    <button type="button" className="bouton bouton-lien" onClick={() => supprimer(g.id)}>
                      Supprimer
                    </button>
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <label className="perso-defaut perso-tout">
        <input type="radio" name="defaut" checked={travail.defaut === VUE_TOUT} onChange={() => maj({ ...travail, defaut: VUE_TOUT })} />
        Ouvrir sur : tous les groupes
      </label>

      {edition ? (
        <form className="perso-formulaire" onSubmit={valider}>
          <h4>{edition.id ? 'Modifier le groupe' : 'Nouveau groupe'}</h4>
          <label className="perso-nom">
            Nom du groupe
            <input type="text" value={edition.nom} maxLength={MAX_NOM} required onChange={(e) => setEdition({ ...edition, nom: e.target.value })} />
          </label>
          <fieldset>
            <legend>Graphiques ({edition.graphes.length}/{MAX_PAR_GROUPE}) — {MAX_PAR_GROUPE} graphiques au plus</legend>
            <ul>
              {choixGraphes.map((g) => (
                <li key={g.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={edition.graphes.includes(g.id)}
                      disabled={plein && !edition.graphes.includes(g.id)}
                      onChange={() => cocher(g.id)}
                    />
                    {g.titre}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="perso-actions-bas">
            <button type="button" className="bouton bouton-secondaire" onClick={() => setEdition(null)}>
              Annuler
            </button>
            <button type="submit" className="bouton bouton-primaire" disabled={!nomValide || !edition.graphes.length}>
              Valider
            </button>
          </div>
        </form>
      ) : (
        <div className="perso-outils">
          <button type="button" className="bouton bouton-secondaire" onClick={() => setEdition({ id: null, nom: '', graphes: [] })} disabled={travail.perso.length >= 20}>
            Nouveau groupe
          </button>
          {travail.perso.length > 0 && (
            <button type="button" className="bouton bouton-secondaire" onClick={seulementMesGroupes}>
              N’afficher que mes groupes
            </button>
          )}
          <button type="button" className="bouton bouton-secondaire" onClick={retablir}>
            Rétablir les groupes d’origine
          </button>
        </div>
      )}

      <div className="perso-actions-bas">
        <button type="button" className="bouton bouton-secondaire" onClick={onAnnuler}>
          Annuler
        </button>
        <button type="button" className="bouton bouton-primaire" disabled={affiches.length === 0} onClick={() => onEnregistrer(normaliser({ ...travail, ordre: affiches }))}>
          Enregistrer
        </button>
      </div>
    </dialog>
  )
}
