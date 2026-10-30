import { useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import { usePeut } from '../../../auth/AuthContext'
import {
  apresAnnee,
  apresSaisies,
  enregistrerSaisies,
  estObjectif,
  repartirAnnee,
  useSaisies,
  type CaseEnvoyee,
  type Groupe,
  type Niveau,
  type VueSaisies,
} from '../../../api/pilotage'
import Etat, { etatErreur } from '../../../components/Etat'
import { Bouton, Confirmer } from '../../../components/Kit'
import { comparer, decimal2, fcfa, montantSigneValide, montantValide, pct, moyenne, sansEspaces, signe, somme, valeurBrute } from '../../../lib/format'
import { lireTSV, nettoyer } from '../../../lib/grille'

const NIVEAUX: { id: Niveau; libelle: string; colonne: string; mot: [string, string] }[] = [
  { id: 'global', libelle: 'Global', colonne: 'Global', mot: ['case', 'cases'] },
  { id: 'site', libelle: 'Par site', colonne: 'Site', mot: ['site', 'sites'] },
  { id: 'service', libelle: 'Par service', colonne: 'Service', mot: ['service', 'services'] },
  { id: 'cellule', libelle: 'Par site et service', colonne: 'Site — service', mot: ['case', 'cases'] },
]

const COLONNES: Record<string, string> = {
  ca: 'Chiffre d’affaires (FCFA)',
  marge: 'Marge (FCFA)',
  or: 'Nombre d’OR',
  devis: 'Nombre de devis',
  factures: 'Nombre de factures',
  obj_ca: 'Objectif de CA (FCFA)',
  obj_marge: 'Objectif de marge (FCFA)',
  obj_ventes: 'Objectif de ventes',
  obj_clients: 'Objectif de clients',
  obj_factures: 'Objectif de factures',
  obj_productivite: 'Objectif de productivité',
}
const COURT: Record<string, string> = {
  ca: 'CA', marge: 'Marge', or: 'OR', devis: 'Devis', factures: 'Factures',
  obj_ca: 'Objectif CA', obj_marge: 'Objectif marge', obj_ventes: 'Objectif ventes', obj_clients: 'Objectif clients',
  obj_factures: 'Objectif factures', obj_productivite: 'Objectif productivité',
}
const MONTANTS = new Set(['ca', 'marge', 'obj_ca', 'obj_marge'])
const SIGNES = new Set(['marge', 'obj_marge'])
const MOYENNES = new Set(['obj_productivite'])
// Comptés à l'unité : un objectif de ventes, de clients ou de factures est entier (comme le serveur).
const NOMBRES = new Set(['obj_ventes', 'obj_clients', 'obj_factures'])

/** CA et marge (et leurs objectifs) en FCFA entiers ; les autres chiffres : deux décimales au plus. */
const montrer = (ind: string, v: string | null | undefined) => (MONTANTS.has(ind) ? fcfa(v) : decimal2(v ?? null))

interface Ligne {
  cle: string
  site_id: number | null
  service_id: number | null
  libelle: string
}
type Valeurs = Record<string, string>

const cleCase = (site: number | null, service: number | null) => `${site ?? ''}|${service ?? ''}`
const cleVal = (l: Ligne, ind: string) => `${l.cle}|${ind}`

/** Lignes de la grille au niveau affiché, construites à partir des sites et services connus. */
function lignesDe(vue: VueSaisies): Ligne[] {
  const ligne = (site: number | null, service: number | null, libelle: string): Ligne => ({ cle: cleCase(site, service), site_id: site, service_id: service, libelle })
  if (vue.niveau === 'global') return [ligne(null, null, 'Global')]
  if (vue.niveau === 'site') return vue.sites.map((s) => ligne(s.id, null, s.libelle))
  if (vue.niveau === 'service') return vue.services.map((s) => ligne(null, s.id, s.libelle))
  return vue.sites.flatMap((si) => vue.services.map((se) => ligne(si.id, se.id, `${si.libelle} — ${se.libelle}`)))
}

/** Valeurs de départ : le chiffre saisi du serveur, sinon la proposition tirée de l'ancien niveau. */
function valeursDe(vue: VueSaisies): Valeurs {
  const v: Valeurs = {}
  for (const l of lignesDe(vue)) for (const i of vue.indicateurs) v[cleVal(l, i)] = ''
  for (const c of vue.cases) {
    for (const i of vue.indicateurs) {
      const x = c.valeurs[i]
      const k = `${cleCase(c.site_id, c.service_id)}|${i}`
      const brut = x?.saisi ?? x?.propose
      if (brut != null && k in v) v[k] = valeurBrute(brut)
    }
  }
  return v
}

/** Chiffre saisi enregistré pour une case, tel qu'il s'affiche. */
const saisiDe = (vue: VueSaisies, l: Ligne, i: string) =>
  valeurBrute(vue.cases.find((c) => c.site_id === l.site_id && c.service_id === l.service_id)?.valeurs[i]?.saisi ?? undefined)

// Mêmes limites que le serveur : 15 chiffres, 12 décimales au plus (signe seulement pour la marge).
const normal = (v: string) => sansEspaces(v).replace(',', '.')
const valide = (ind: string, v: string) =>
  !v.trim() || (SIGNES.has(ind) ? montantSigneValide(v) : montantValide(v) && (!NOMBRES.has(ind) || /^\d+([.,]0*)?$/.test(sansEspaces(v))))
const nonNul = (v: string | null | undefined) => v != null && signe(v) !== 0

/** Deux saisies de même valeur, quelle que soit leur mise en forme ("1 200,50" = "1200.5"). */
function memeValeur(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return !a.trim() && !b.trim()
  const [x, y] = [normal(a), normal(b)]
  return /^-?\d+(\.\d+)?$/.test(x) && /^-?\d+(\.\d+)?$/.test(y) ? comparer(x, y) === 0 : x === y
}

/** Taux de marge d'affichage : marge / CA, seulement avec un CA strictement positif. Number() sert à l'affichage seulement. */
function taux(ca: string | null, marge: string | null): string | null {
  if (ca == null || marge == null || signe(ca) <= 0) return null
  return String(Number(marge) / Number(ca))
}

interface PropsGrille {
  vue: VueSaisies
  groupe: Groupe
  periode: string
  /** Niveau demandé, pas encore reçu du serveur. */
  demandeNiveau?: Niveau
  enAttente: boolean
  onNiveau: (n: Niveau) => void
  /** Signale les modifications non enregistrées (garde en quittant l'écran). */
  onModifs: (sale: boolean) => void
}

function Grille({ vue, groupe, periode, demandeNiveau, enAttente, onNiveau, onModifs }: PropsGrille) {
  const qc = useQueryClient()
  const idNote = useId()
  const table = useRef<HTMLTableElement>(null)
  const [vuePrec, setVuePrec] = useState(vue)
  const [valeurs, setValeurs] = useState(() => valeursDe(vue))
  const [envoi, setEnvoi] = useState<{ cours: boolean; erreur?: string; ok?: boolean }>({ cours: false })
  const [info, setInfo] = useState('')
  const [demande, setDemande] = useState<Niveau | null>(null)
  const [focus, setFocus] = useState<string | null>(null)

  const lignes = useMemo(() => lignesDe(vue), [vue])
  const base = useMemo(() => valeursDe(vue), [vue])
  const inds = vue.indicateurs
  const avecTaux = groupe === 'ca_marge'
  const objectif = estObjectif(groupe)
  const [annuel, setAnnuel] = useState(false)
  const niveauAffiche = demandeNiveau ?? vue.niveau
  const defNiveau = NIVEAUX.find((n) => n.id === vue.niveau)

  // Nouvelle réponse du serveur : la grille la reprend si le niveau change ou si rien n'a été tapé ;
  // sinon (simple rechargement) les cases tapées sont gardées, les autres se mettent à jour.
  if (vue !== vuePrec) {
    setVuePrec(vue)
    const avant = valeursDe(vuePrec)
    const intact = Object.keys(avant).every((k) => memeValeur(valeurs[k] ?? '', avant[k]))
    if (vue.niveau !== vuePrec.niveau || intact) setValeurs(base)
    else setValeurs((p) => Object.fromEntries(Object.keys(base).map((k) => [k, memeValeur(p[k] ?? '', avant[k] ?? '') ? base[k] : (p[k] ?? '')])))
  }

  const caseServeur = (l: Ligne) => vue.cases.find((c) => c.site_id === l.site_id && c.service_id === l.service_id)
  const texte = (l: Ligne, i: string) => valeurs[cleVal(l, i)] ?? ''
  const invalide = (l: Ligne, i: string) => !valide(i, texte(l, i))
  const nbInvalides = lignes.reduce((n, l) => n + inds.filter((i) => invalide(l, i)).length, 0)
  const saisieModifiee = lignes.some((l) => inds.some((i) => !memeValeur(texte(l, i), base[cleVal(l, i)] ?? '')))
  const changeNiveau = vue.niveau_enregistre !== null && vue.niveau_enregistre !== vue.niveau
  const modifie = saisieModifiee || changeNiveau
  // Quitter l'écran perd la saisie tapée, ou la proposition tirée de l'ancien niveau qui n'est pas enregistrée.
  const sale = saisieModifiee || (changeNiveau && Object.values(base).some((v) => v.trim() !== ''))
  // Pas d'envoi pendant le chargement d'un autre niveau : la grille montre encore l'ancien.
  const aEnregistrer = modifie && nbInvalides === 0 && !envoi.cours && !enAttente

  // Valeur retenue d'une case pour les totaux et les taux : le chiffre tapé, sinon la somme des employés.
  const effective = (l: Ligne, i: string): string | null => {
    const v = texte(l, i)
    if (v.trim()) return valide(i, v) ? normal(v) : null
    return caseServeur(l)?.valeurs[i]?.employes ?? null
  }

  const totalLocal = (i: string) => {
    const vals = lignes.map((l) => effective(l, i))
    const presentes = vals.filter((x): x is string => x != null)
    // Productivité : moyenne exacte des cases renseignées, sinon somme.
    const valeur = MOYENNES.has(i) ? moyenne(presentes) : somme(presentes)
    return { valeur, partiel: presentes.length < vals.length, renseignes: presentes.length, attendus: vals.length }
  }
  // Chiffres du serveur tant que la grille est telle qu'il l'a enregistrée ; calcul local dès qu'une case change.
  const inchangee = (l: Ligne) => inds.every((i) => memeValeur(texte(l, i), saisiDe(vue, l, i)))
  const toutInchange = lignes.every(inchangee)
  const total = (i: string) => (toutInchange ? (vue.totaux[i] ?? totalLocal(i)) : totalLocal(i))
  const tauxTotal = !avecTaux ? null : toutInchange && vue.taux_marge !== undefined ? vue.taux_marge : taux(total('ca').valeur, total('marge').valeur)
  const tauxLigne = (l: Ligne) => {
    const srv = caseServeur(l)
    if (inchangee(l) && srv?.taux_marge !== undefined) return srv.taux_marge
    return taux(effective(l, 'ca'), effective(l, 'marge'))
  }

  const changer = (k: string, v: string) => {
    setValeurs((p) => ({ ...p, [k]: v }))
    setEnvoi({ cours: false })
    setInfo('')
  }

  const choisirNiveau = (n: Niveau) => {
    if (n === niveauAffiche) return
    if (saisieModifiee) setDemande(n)
    else onNiveau(n)
  }

  const enregistrer = async () => {
    if (!aEnregistrer) return
    setEnvoi({ cours: true })
    const cases: CaseEnvoyee[] = lignes.map((l) => ({
      site_id: l.site_id,
      service_id: l.service_id,
      valeurs: Object.fromEntries(inds.map((i) => [i, texte(l, i).trim() ? normal(texte(l, i)) : null])),
    }))
    try {
      const v = await enregistrerSaisies(groupe, vue.annee, vue.mois, vue.niveau, cases)
      // La grille repart de ce que le serveur a retenu, sans attendre le rechargement.
      setVuePrec(v)
      setValeurs(valeursDe(v))
      apresSaisies(qc, v)
      setEnvoi({ cours: false, ok: true })
    } catch (e) {
      setEnvoi({ cours: false, erreur: e instanceof Error ? e.message : 'Enregistrement impossible.' })
    }
  }

  // Ctrl+S enregistre (sans ouvrir la boîte « enregistrer la page » du navigateur).
  const enregistrerRef = useRef(enregistrer)
  useEffect(() => {
    enregistrerRef.current = enregistrer
  })
  useEffect(() => {
    const touche = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void enregistrerRef.current()
      }
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [])

  // Fermer ou recharger l'onglet avec une saisie non enregistrée : le navigateur demande confirmation.
  useEffect(() => {
    if (!sale) return
    const avant = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', avant)
    return () => window.removeEventListener('beforeunload', avant)
  }, [sale])

  useEffect(() => {
    onModifs(sale)
    return () => onModifs(false)
  }, [sale, onModifs])

  // À l'entrée dans une case, son contenu est sélectionné : la frappe remplace, comme dans un tableur.
  useEffect(() => {
    if (focus) table.current?.querySelector<HTMLInputElement>(`input[data-k="${focus}"]`)?.select()
  }, [focus])

  const position = (cible: EventTarget) => {
    const el = cible as HTMLElement
    if (el.tagName !== 'INPUT') return null
    const r = Number(el.dataset.r)
    const c = Number(el.dataset.c)
    return Number.isNaN(r) || Number.isNaN(c) ? null : { r, c, el: el as HTMLInputElement }
  }
  const aller = (r: number, c: number) => table.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`)?.focus()

  // Clavier de tableur : Entrée descend (Maj+Entrée remonte), flèches d'une case à l'autre.
  const surTouche = (e: KeyboardEvent<HTMLTableElement>) => {
    const p = position(e.target)
    if (!p) return
    const { r, c, el } = p
    const toutSelectionne = el.selectionStart === 0 && el.selectionEnd === el.value.length
    let cible: [number, number] | null = null
    if (e.key === 'Enter') cible = [e.shiftKey ? r - 1 : r + 1, c]
    else if (e.key === 'ArrowDown') cible = [r + 1, c]
    else if (e.key === 'ArrowUp') cible = [r - 1, c]
    else if (e.key === 'ArrowLeft' && (toutSelectionne || (el.selectionStart === 0 && el.selectionEnd === 0))) cible = [r, c - 1]
    else if (e.key === 'ArrowRight' && (toutSelectionne || el.selectionStart === el.value.length)) cible = [r, c + 1]
    if (cible) {
      e.preventDefault()
      aller(cible[0], cible[1])
    }
  }

  // Bloc copié dans Excel : lignes et colonnes se rangent à partir de la case visée ; ce qui dépasse est ignoré.
  const surColle = (e: ClipboardEvent<HTMLTableElement>) => {
    const p = position(e.target)
    if (!p) return
    const bloc = lireTSV(e.clipboardData.getData('text/plain'))
    if (bloc.length === 0 || (bloc.length === 1 && bloc[0].length === 1)) return // une seule valeur : collage normal
    e.preventDefault()
    const suite = { ...valeurs }
    let n = 0
    let horsGrille = 0
    bloc.forEach((cellules, dr) => {
      const l = lignes[p.r + dr]
      if (!l) {
        horsGrille += 1
        return
      }
      cellules.forEach((v, dc) => {
        const i = inds[p.c + dc]
        if (i === undefined) return
        suite[cleVal(l, i)] = nettoyer(v)
        n += 1
      })
    })
    setValeurs(suite)
    setEnvoi({ cours: false })
    setInfo(`${n} case${n > 1 ? 's' : ''} collée${n > 1 ? 's' : ''}${horsGrille ? ` ; ${horsGrille} ligne${horsGrille > 1 ? 's' : ''} hors de la grille ignorée${horsGrille > 1 ? 's' : ''}` : ''}.`)
  }

  // Séparateurs de milliers à la sortie de la case ; la valeur brute à l'édition.
  const affiche = (i: string, v: string) => (v.trim() && valide(i, v) ? valeurBrute(normal(v)) : v)

  const partielTexte = (t: { renseignes: number; attendus: number }) => {
    const mot = defNiveau?.mot ?? ['case', 'cases']
    return `partiel (${t.renseignes} ${t.renseignes > 1 ? mot[1] : mot[0]} sur ${t.attendus})`
  }
  const aRepartir = Object.entries(vue.a_repartir ?? {})

  return (
    <div className="saisie-donnees-groupe">
      <fieldset className="saisie-niveau">
        <legend>Niveau de saisie</legend>
        {NIVEAUX.map((n) => (
          <label key={n.id}>
            <input type="radio" name={`niveau-${groupe}`} checked={niveauAffiche === n.id} onChange={() => choisirNiveau(n.id)} />
            {n.libelle}
          </label>
        ))}
      </fieldset>
      <p className="note" id={idNote}>
        {objectif ? (
          <>
            Objectifs de {periode}{groupe === 'obj_ca_marge' ? ' en FCFA' : ''}. Une case laissée vide n’a pas d’objectif ; la productivité se moyenne, les autres objectifs s’additionnent.{' '}
            Entrée passe à la case du dessous ; vous pouvez coller un bloc copié dans Excel.
          </>
        ) : (
          <>
            {groupe === 'ca_marge' ? `Montants de ${periode} en FCFA.` : `Chiffres de ${periode}.`} Une case laissée vide se calcule à partir des chiffres des employés.{' '}
            Entrée passe à la case du dessous ; vous pouvez coller un bloc copié dans Excel.{' '}
            <Link to="/admin">Détail par employé</Link>
          </>
        )}
      </p>
      {aRepartir.length > 0 && (
        <p className="saisie-a-repartir" role="status">
          À répartir : {aRepartir.map(([i, v]) => `${COURT[i] ?? i} ${montrer(i, v)}`).join(' ; ')}. Ces chiffres de l’ancien niveau ne rentrent dans aucune case : tapez-les dans la grille.
        </p>
      )}
      {lignes.length === 0 ? (
        <Etat type="vide" titre="Aucune ligne à renseigner" aide="" />
      ) : (
        <div className="panneau" aria-busy={enAttente || undefined}>
          <div className="panneau-corps">
            <table className="dense saisie-donnees" aria-describedby={idNote} ref={table} onKeyDown={surTouche} onPaste={surColle}>
              <caption className="sr-only">Saisie {periode}, niveau {defNiveau?.libelle.toLowerCase()}</caption>
              <thead>
                <tr>
                  <th scope="col">{defNiveau?.colonne}</th>
                  {inds.map((i) => <th key={i} scope="col" className="num">{COLONNES[i] ?? i}</th>)}
                  {avecTaux && <th scope="col" className="num">Taux de marge</th>}
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, r) => (
                  <tr key={l.cle}>
                    <th scope="row">{l.libelle}</th>
                    {inds.map((i, c) => {
                      const k = cleVal(l, i)
                      const v = texte(l, i)
                      const ko = invalide(l, i)
                      const x = caseServeur(l)?.valeurs[i]
                      const calcule = !v.trim() && x?.origine === 'calcule'
                      const ecart = x?.ecart
                      const idErreur = `${idNote}-err-${r}-${c}`
                      return (
                        <td key={i} className={`num${ko ? ' ko' : ''}${calcule ? ' calcule' : ''}`}>
                          <input
                            type="text"
                            inputMode="decimal"
                            data-k={k}
                            data-r={r}
                            data-c={c}
                            aria-label={`${COURT[i] ?? i} : ${l.libelle}`}
                            aria-invalid={ko || undefined}
                            aria-describedby={ko ? idErreur : undefined}
                            title={calcule ? 'Somme des employés' : undefined}
                            placeholder={!v.trim() && x?.employes != null ? valeurBrute(x.employes) : ''}
                            value={focus === k ? v : affiche(i, v)}
                            onFocus={() => setFocus(k)}
                            onBlur={() => setFocus((f) => (f === k ? null : f))}
                            onChange={(e) => changer(k, e.target.value)}
                          />
                          {ko && <small className="erreur-case" id={idErreur}>Valeur invalide</small>}
                          {nonNul(ecart) && <small className={`non-reparti${signe(ecart!) < 0 ? ' negatif' : ''}`}>non réparti : {montrer(i, ecart)}</small>}
                        </td>
                      )
                    })}
                    {avecTaux && <td className="num">{pct(tauxLigne(l) ?? undefined)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="total">
                  <th scope="row">TOTAL</th>
                  {inds.map((i) => {
                    const t = total(i)
                    return (
                      <td key={i} className="num">
                        {montrer(i, t.valeur)}
                        {t.partiel && <small className="partiel-mention">{partielTexte(t)}</small>}
                      </td>
                    )
                  })}
                  {avecTaux && <td className="num">{pct(tauxTotal ?? undefined)}</td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      <div className="saisie-pied">
        <span className="note">
          {nbInvalides > 0
            ? `${nbInvalides} valeur${nbInvalides > 1 ? 's' : ''} invalide${nbInvalides > 1 ? 's' : ''} : chiffres, virgule ou point, 12 décimales au plus${groupe === 'ca_marge' || groupe === 'obj_ca_marge' ?' (signe − permis pour la marge)' : ''}.`
            : modifie ? 'Modifications non enregistrées.' : envoi.ok ? 'Enregistré.' : info || 'Aucune modification.'}
          {nbInvalides === 0 && modifie && info ? ` ${info}` : ''}
        </span>
        {envoi.erreur && <p className="champ-erreur" role="alert">{envoi.erreur}</p>}
        <span className="sr-only" role="status">{envoi.ok && !modifie ? 'Enregistrement terminé.' : ''}</span>
        {objectif && lignes.length > 0 && (
          <Bouton variante="secondaire" onClick={() => setAnnuel(true)} disabled={sale || enAttente || envoi.cours} title={sale ? 'Enregistrez d’abord le mois en cours' : undefined}>
            Répartir un objectif annuel
          </Bouton>
        )}
        <Bouton onClick={enregistrer} disabled={!aEnregistrer}>
          {envoi.cours ? 'Enregistrement…' : 'Enregistrer'}
        </Bouton>
      </div>
      <Confirmer
        ouvert={demande !== null}
        titre="Changer de niveau de saisie ?"
        confirmer="Changer de niveau"
        onConfirmer={() => {
          if (demande) onNiveau(demande)
          setDemande(null)
        }}
        onAnnuler={() => setDemande(null)}
      >
        <p>Les chiffres tapés et non enregistrés seront effacés.</p>
      </Confirmer>
      {annuel && (
        <RepartirAnnee
          vue={vue}
          groupe={groupe}
          lignes={lignes}
          onFerme={(msg) => {
            setAnnuel(false)
            if (msg) {
              setEnvoi({ cours: false })
              setInfo(msg)
            }
          }}
        />
      )}
    </div>
  )
}

/** Objectifs annuels par case, répartis par le serveur sur les 12 mois de l'année affichée (même niveau). */
function RepartirAnnee({ vue, groupe, lignes, onFerme }: { vue: VueSaisies; groupe: Groupe; lignes: Ligne[]; onFerme: (msg?: string) => void }) {
  const qc = useQueryClient()
  const inds = vue.indicateurs
  const [totaux, setTotaux] = useState<Valeurs>({})
  const [envoi, setEnvoi] = useState<{ cours: boolean; erreur?: string }>({ cours: false })
  const texte = (l: Ligne, i: string) => totaux[cleVal(l, i)] ?? ''
  const nbInvalides = lignes.reduce((n, l) => n + inds.filter((i) => !valide(i, texte(l, i))).length, 0)
  const nbRemplis = lignes.reduce((n, l) => n + inds.filter((i) => texte(l, i).trim()).length, 0)

  const repartir = async () => {
    setEnvoi({ cours: true })
    const cases = lignes.flatMap((l) =>
      inds.filter((i) => texte(l, i).trim()).map((i) => ({ site_id: l.site_id, service_id: l.service_id, indicateur: i, total: normal(texte(l, i)) })),
    )
    try {
      const r = await repartirAnnee(groupe, vue.annee, vue.niveau, cases)
      apresAnnee(qc, groupe, vue.annee)
      const n = r.ecrases.length
      onFerme(`Objectifs ${vue.annee} répartis sur les 12 mois${n ? ` ; ${n} mois déjà saisi${n > 1 ? 's' : ''} remplacé${n > 1 ? 's' : ''}` : ''}.`)
    } catch (e) {
      setEnvoi({ cours: false, erreur: e instanceof Error ? e.message : 'Répartition impossible.' })
    }
  }

  return (
    <Confirmer
      ouvert
      titre={`Répartir un objectif annuel ${vue.annee}`}
      confirmer={envoi.cours ? 'Répartition…' : 'Répartir sur 12 mois'}
      desactive={envoi.cours || nbRemplis === 0 || nbInvalides > 0}
      onConfirmer={repartir}
      onAnnuler={() => onFerme()}
    >
      <p>
        Tapez le total de l’année : chaque mois reçoit un douzième (le reste va sur décembre) ; la productivité garde la même valeur chaque mois.{' '}
        Les objectifs déjà saisis de ces cases sont remplacés sur toute l’année.
      </p>
      <table className="dense saisie-donnees">
        <caption className="sr-only">Objectifs annuels {vue.annee}</caption>
        <thead>
          <tr>
            <th scope="col">{NIVEAUX.find((n) => n.id === vue.niveau)?.colonne}</th>
            {inds.map((i) => <th key={i} scope="col" className="num">{COLONNES[i] ?? i}</th>)}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.cle}>
              <th scope="row">{l.libelle}</th>
              {inds.map((i) => {
                const ko = !valide(i, texte(l, i))
                return (
                  <td key={i} className={`num${ko ? ' ko' : ''}`}>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`${COURT[i] ?? i} annuel : ${l.libelle}`}
                      aria-invalid={ko || undefined}
                      value={texte(l, i)}
                      onChange={(e) => setTotaux((p) => ({ ...p, [cleVal(l, i)]: e.target.value }))}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {nbInvalides > 0 && <p className="champ-erreur">{nbInvalides} valeur{nbInvalides > 1 ? 's' : ''} invalide{nbInvalides > 1 ? 's' : ''}.</p>}
      {envoi.erreur && <p className="champ-erreur" role="alert">{envoi.erreur}</p>}
    </Confirmer>
  )
}

function OngletGroupe({ groupe, annee, mois, periode, onModifs }: { groupe: Groupe; annee: number; mois: number; periode: string; onModifs: (sale: boolean) => void }) {
  // Niveau choisi par l'utilisateur ; sans choix, celui que le serveur propose. Un autre mois repart du niveau du serveur (l'onglet est remonté).
  const [choix, setChoix] = useState<Niveau | undefined>(undefined)
  const q = useSaisies(groupe, annee, mois, true, choix)
  if (q.isLoading) return <Etat type="chargement" />
  if (q.isError || !q.data) return <Etat type={etatErreur(q.error)} onRetry={() => q.refetch()} />
  return <Grille vue={q.data} groupe={groupe} periode={periode} demandeNiveau={choix} enAttente={q.isPlaceholderData} onNiveau={setChoix} onModifs={onModifs} />
}

type Onglet = Groupe | 'budgets'

interface Props {
  annee: number
  mois: number
  periode: string
  budgets: ReactNode
  /** Signale au parent les modifications non enregistrées de la grille affichée. */
  onModifs?: (sale: boolean) => void
  /** Exécute une action qui quitte la grille, après confirmation s'il y a des modifications. */
  garde?: (action: () => void) => void
}

/** Données du mois : CA et marge, OR / devis / factures (saisies à plusieurs niveaux) et budgets. */
export default function SaisieDonnees({ annee, mois, periode, budgets, onModifs, garde = (a) => a() }: Props) {
  const avecMarge = usePeut('marge:read')
  const avecLecture = usePeut('import:read')
  const onglets: { id: Onglet; libelle: string }[] = [
    ...(avecLecture && avecMarge ? [{ id: 'ca_marge' as const, libelle: 'CA et marge' }] : []),
    ...(avecLecture ? [{ id: 'activite' as const, libelle: 'OR, devis, factures' }] : []),
    ...(avecLecture && avecMarge ? [{ id: 'obj_ca_marge' as const, libelle: 'Objectifs CA et marge' }] : []),
    ...(avecLecture ? [{ id: 'obj_activite' as const, libelle: 'Objectifs d’activité' }] : []),
    { id: 'budgets', libelle: 'Budgets' },
  ]
  // L'onglet de départ est retenu dès qu'un onglet de saisie existe : un droit qui arrive ensuite (marge) ne change pas d'onglet sous les doigts.
  const [choix, setChoix] = useState<Onglet | null>(null)
  if (choix === null && onglets[0].id !== 'budgets') setChoix(onglets[0].id)
  const actif: Onglet = choix !== null && onglets.some((o) => o.id === choix) ? choix : onglets[0].id
  const id = useId()
  const signaler = useCallback((sale: boolean) => onModifs?.(sale), [onModifs])

  return (
    <div className="saisie-donnees-bloc">
      <div className="saisie-onglets" role="tablist" aria-label="Données du mois">
        {onglets.map((o) => (
          <button
            key={o.id}
            type="button"
            role="tab"
            id={`${id}-${o.id}`}
            aria-selected={actif === o.id}
            aria-controls={`${id}-panneau`}
            tabIndex={actif === o.id ? 0 : -1}
            onClick={() => o.id !== actif && garde(() => setChoix(o.id))}
          >
            {o.libelle}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panneau`} aria-labelledby={`${id}-${actif}`}>
        {actif === 'budgets' ? budgets : <OngletGroupe key={`${actif}-${annee}-${mois}`} groupe={actif} annee={annee} mois={mois} periode={periode} onModifs={signaler} />}
      </div>
    </div>
  )
}
