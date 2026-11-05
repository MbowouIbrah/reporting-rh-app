import { ArrowDown, ArrowUp } from 'lucide-react'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import {
  type ConfigGroupes, descGroupe, GRAPHES, type Groupe, GROUPES_ORIGINE, MAX_NOM, MAX_PAR_GROUPE, nouvelId, retablirOrigine, tousLesGroupes, VUE_TOUT,
} from '../lib/groupesGraphes'

/** Le défaut suit les cases : le groupe s'il est seul coché, sinon tous les groupes cochés. */
function normaliser(c: ConfigGroupes): ConfigGroupes {
  return { ...c, defaut: c.ordre.length === 1 ? c.ordre[0] : VUE_TOUT }
}

interface Edition {
  /** null : nouveau groupe. */
  id: string | null
  nom: string
  graphes: string[]
  /** Groupe d'origine : seul le nom change, les graphiques sont fixes. */
  origine?: boolean
}

/**
 * Fenêtre « Personnaliser » : on travaille sur une copie du réglage, appliquée seulement par « Enregistrer ».
 * Affichée dès qu'elle est montée ; `dispo` : identifiants des graphiques qui ont des données.
 */
export default function PersonnaliserGroupes({ config, dispo, noms = {}, onNoms, onEnregistrer, onAnnuler }: {
  config: ConfigGroupes
  dispo: Set<string>
  /** Noms choisis par l'administration pour les groupes d'origine (identifiant -> nom). */
  noms?: Record<string, string>
  /** Fourni seulement à qui peut renommer les groupes pour tous : enregistre les noms communs sur le serveur.
   *  Sans lui, les noms saisis sont personnels (gardés dans le réglage de l'utilisateur). */
  onNoms?: (n: Record<string, string>) => Promise<void>
  onEnregistrer: (c: ConfigGroupes) => void
  onAnnuler: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const idTitre = useId()
  const [travail, setTravail] = useState<ConfigGroupes>(config)
  const [edition, setEdition] = useState<Edition | null>(null)
  const [brouillon, setBrouillon] = useState<Record<string, string>>(onNoms ? noms : (config.noms ?? {}))
  const [erreur, setErreur] = useState('')
  const [envoi, setEnvoi] = useState(false)
  useEffect(() => {
    const d = ref.current
    if (!d || d.open) return
    if (d.showModal) d.showModal()
    else d.setAttribute('open', '')
  }, [])

  // Noms des groupes d'origine : seuls les champs non vides comptent, un champ vide = nom par défaut
  const nomsSaisis: Record<string, string> = {}
  for (const g of GROUPES_ORIGINE) {
    const n = (brouillon[g.id] ?? '').trim()
    if (n) nomsSaisis[g.id] = n
  }
  const sansNomsPerso = (c: ConfigGroupes): ConfigGroupes => {
    const { noms: _n, ...reste } = c
    return reste
  }
  // admin : aperçu des noms communs saisis ; autres : noms personnels saisis, sinon noms communs
  const tous = onNoms
    ? tousLesGroupes(sansNomsPerso(travail), nomsSaisis)
    : tousLesGroupes({ ...travail, noms: nomsSaisis }, noms)
  const parId = new Map(tous.map((g) => [g.id, g]))
  // Place de chaque ligne fixe pendant la fenêtre : cocher ou décocher ne la déplace pas
  const [rang, setRang] = useState<string[]>(() => {
    const ids = tousLesGroupes(config).map((g) => g.id)
    return [...new Set([...config.ordre.filter((id) => ids.includes(id)), ...ids])]
  })
  const ids = [...new Set([...rang, ...tous.map((g) => g.id)])].filter((id) => parId.has(id))
  const lignes: Groupe[] = ids.map((id) => parId.get(id)!)
  const affiches = ids.filter((id) => travail.ordre.includes(id))
  const maj = (c: ConfigGroupes) => setTravail(normaliser(c))
  const montrer = (montres: string[]) => maj({ ...travail, ordre: ids.filter((id) => montres.includes(id)) })
  const basculer = (id: string) => montrer(affiches.includes(id) ? affiches.filter((x) => x !== id) : [...affiches, id])
  const toutAfficher = (oui: boolean) => montrer(oui ? ids : [])
  const deplacer = (id: string, sens: -1 | 1) => {
    const i = ids.indexOf(id)
    const j = i + sens
    if (i < 0 || j < 0 || j >= ids.length) return
    const o = [...ids]
    ;[o[i], o[j]] = [o[j], o[i]]
    setRang(o)
    maj({ ...travail, ordre: o.filter((x) => affiches.includes(x)) })
  }
  const supprimer = (id: string) =>
    maj({ ...travail, perso: travail.perso.filter((g) => g.id !== id), ordre: affiches.filter((x) => x !== id) })
  const seulementMesGroupes = () => maj({ ...travail, ordre: travail.perso.map((g) => g.id) })
  const retablir = () => {
    const c = retablirOrigine(travail)
    setRang([...c.ordre, ...travail.perso.map((g) => g.id)])
    maj(c)
  }

  const nomsChanges = () => {
    const avant = GROUPES_ORIGINE.filter((g) => noms[g.id]).map((g) => [g.id, noms[g.id]])
    return JSON.stringify(avant) !== JSON.stringify(Object.entries(nomsSaisis))
  }
  const enregistrer = async () => {
    const base = { ...travail, ordre: affiches }
    const c = normaliser(onNoms ? base : Object.keys(nomsSaisis).length ? { ...base, noms: nomsSaisis } : sansNomsPerso(base))
    if (onNoms && nomsChanges()) {
      setErreur('')
      setEnvoi(true)
      try {
        await onNoms(nomsSaisis)
      } catch {
        setErreur('Les noms des groupes n’ont pas pu être enregistrés. Réessayez.')
        setEnvoi(false)
        return
      }
      setEnvoi(false)
    }
    onEnregistrer(c)
  }

  const valider = (e: FormEvent) => {
    e.preventDefault()
    if (!edition) return
    const nom = edition.nom.trim()
    if (edition.origine && edition.id) {
      const id = edition.id
      const parDefaut = onNoms ? GROUPES_ORIGINE.find((g) => g.id === id)!.nom : (noms[id] ?? GROUPES_ORIGINE.find((g) => g.id === id)!.nom)
      setBrouillon({ ...brouillon, [id]: nom === parDefaut ? '' : nom })
      setEdition(null)
      return
    }
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
  const nomValide = !!edition && (edition.origine || edition.nom.trim().length > 0)

  return (
    <dialog ref={ref} className="perso-groupes" aria-labelledby={idTitre} onCancel={onAnnuler}>
      {edition ? (
        <form className="perso-edition" onSubmit={valider}>
          <h3 id={idTitre}>{edition.id ? 'Modifier le groupe' : 'Nouveau groupe'}</h3>
          <p className="perso-aide">
            {edition.origine
              ? `Changez le nom du groupe (${onNoms ? 'vu par tous' : 'vu par vous seul'}) ; ses graphiques sont fixes.`
              : `Donnez un nom au groupe et cochez jusqu’à ${MAX_PAR_GROUPE} graphiques.`}
          </p>
          <label className="perso-nom">
            Nom du groupe
            <input
              type="text"
              value={edition.nom}
              maxLength={MAX_NOM}
              required={!edition.origine}
              placeholder={edition.origine && edition.id ? (onNoms ? undefined : noms[edition.id]) ?? GROUPES_ORIGINE.find((g) => g.id === edition.id)?.nom : undefined}
              onChange={(e) => setEdition({ ...edition, nom: e.target.value })} />
          </label>
          {edition.origine ? (
            <section className="perso-graphes-fixes" aria-label="Graphiques du groupe">
              <h4>Graphiques du groupe</h4>
              <ul>
                {edition.graphes.map((id) => (
                  <li key={id}>{GRAPHES.find((g) => g.id === id)?.titre ?? id}</li>
                ))}
              </ul>
            </section>
          ) : (
          <fieldset>
            <legend>Graphiques ({edition.graphes.length}/{MAX_PAR_GROUPE})</legend>
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
          )}
          <div className="perso-actions-bas perso-pied">
            <button type="button" className="bouton bouton-secondaire" onClick={() => setEdition(null)}>
              Annuler
            </button>
            <button type="submit" className="bouton bouton-primaire" disabled={!nomValide || !edition.graphes.length}>
              Valider
            </button>
          </div>
        </form>
      ) : (
        <>
          <h3 id={idTitre}>Personnaliser les groupes</h3>
          <p className="perso-aide">Cochez les groupes à afficher directement et choisissez leur ordre. Les autres restent accessibles dans le menu.</p>
          <label className="perso-defaut perso-tout">
            <input type="checkbox" checked={affiches.length === ids.length} disabled={ids.length < 2} onChange={(e) => toutAfficher(e.target.checked)} />
            Afficher tous les groupes
          </label>
          <ul className="perso-liste">
            {lignes.map((g) => {
              const affiche = affiches.includes(g.id)
              const i = ids.indexOf(g.id)
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
                    <button type="button" className="perso-icone" aria-label={`Descendre ${g.nom}`} disabled={!affiche || i === ids.length - 1} onClick={() => deplacer(g.id, 1)}>
                      <ArrowDown aria-hidden="true" size={16} />
                    </button>
                    <button
                      type="button"
                      className="bouton bouton-lien"
                      aria-label={`Modifier ${g.nom}`}
                      onClick={() => setEdition({ id: g.id, nom: g.nom, graphes: [...g.graphes], origine: !perso })}
                    >
                      Modifier
                    </button>
                    {perso && (
                      <button type="button" className="bouton bouton-lien" onClick={() => supprimer(g.id)}>
                        Supprimer
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>

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

          {erreur && <p className="perso-erreur" role="alert">{erreur}</p>}
          <div className="perso-actions-bas perso-pied">
            <button type="button" className="bouton bouton-secondaire" onClick={onAnnuler}>
              Annuler
            </button>
            <button type="button" className="bouton bouton-primaire" disabled={affiches.length === 0 || envoi} onClick={enregistrer}>
              Enregistrer
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}
