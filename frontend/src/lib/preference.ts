import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useMonId } from '../auth/AuthContext'

/** Réglage d'affichage propre à chaque utilisateur (ex. `groupes.evolution`). Le serveur le garde
 *  (`/auth/preferences/<nom>`, suivi sur tous les postes) ; le navigateur en garde une copie
 *  (clé `reporting-rh.pref.<id utilisateur>.<nom>`) pour l'affichage immédiat et les autres onglets. */
const CLE = 'reporting-rh.pref.'
const ATTENTE = '.attente'

type Lire<T> = (v: unknown) => T | null

/** `cle` : `<id utilisateur>.<nom>`. Copie absente ou illisible : valeur par défaut. */
export function lirePref<T>(cle: string, lire: Lire<T>, defaut: T): T {
  try {
    const brut = localStorage.getItem(CLE + cle)
    if (brut === null) return defaut
    return lire(JSON.parse(brut)) ?? defaut
  } catch {
    return defaut
  }
}

/** Copie du navigateur présente et lisible (sinon rien à reprendre sur le serveur). */
function copieLocale<T>(cle: string, lire: Lire<T>): T | null {
  try {
    const brut = localStorage.getItem(CLE + cle)
    return brut === null ? null : lire(JSON.parse(brut))
  } catch {
    return null
  }
}

/** Une valeur égale au défaut n'a pas besoin de copie : la clé est retirée. */
export function ecrirePref<T>(cle: string, valeur: T, defaut: T) {
  try {
    if (JSON.stringify(valeur) !== JSON.stringify(defaut)) localStorage.setItem(CLE + cle, JSON.stringify(valeur))
    else localStorage.removeItem(CLE + cle)
  } catch {
    /* stockage indisponible : le réglage vaut pour la page en cours seulement */
  }
}

function marquer(cle: string, oui: boolean) {
  try {
    if (oui) localStorage.setItem(CLE + cle + ATTENTE, '1')
    else localStorage.removeItem(CLE + cle + ATTENTE)
  } catch {
    /* stockage indisponible */
  }
}

/** Envoi non encore reçu par le serveur (échec ou en cours) : la copie du navigateur fait foi. */
export function enAttente(cle: string): boolean {
  try {
    return localStorage.getItem(CLE + cle + ATTENTE) !== null
  } catch {
    return false
  }
}

const enCours = new Set<string>()
/** Utilisateur connecté : un envoi resté en file pour un autre compte ne part pas (renvoyé à sa reconnexion). */
let idCourant = 0
const aEnvoyer = new Map<string, unknown>()

/** Envois l'un après l'autre, seule la dernière valeur en attente part : le serveur ne peut pas
 *  garder un réglage plus ancien que l'écran. En cas d'échec, il est renvoyé au prochain chargement. */
function envoyer(cle: string, valeur: unknown) {
  marquer(cle, true)
  aEnvoyer.set(cle, valeur)
  if (enCours.has(cle)) return
  enCours.add(cle)
  const suivant = () => {
    if (!aEnvoyer.has(cle)) {
      enCours.delete(cle)
      return
    }
    const v = aEnvoyer.get(cle)
    aEnvoyer.delete(cle)
    if (cle.slice(0, cle.indexOf('.')) !== String(idCourant)) {
      enCours.delete(cle)
      return
    }
    const nom = cle.slice(cle.indexOf('.') + 1)
    api(`/auth/preferences/${nom}`, { method: 'PUT', body: JSON.stringify({ valeur: v }) })
      .then(() => {
        if (!aEnvoyer.has(cle)) marquer(cle, false)
      })
      .catch((e) => {
        // refus définitif (forme rejetée) : inutile de le renvoyer ; sinon la marque reste, renvoi au prochain chargement
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && !aEnvoyer.has(cle)) marquer(cle, false)
      })
      .finally(suivant)
  }
  suivant()
}

/** `lire` valide une valeur venue du serveur ou du navigateur (null si la forme est mauvaise). */
export function usePreference<T>(nom: string, lire: Lire<T>, defaut: T): [T, (v: T) => void] {
  const id = useMonId() ?? 0
  const cle = `${id}.${nom}`
  idCourant = id
  const outils = useRef({ lire, defaut })
  outils.current = { lire, defaut }
  const [etat, setEtat] = useState(() => ({ cle, valeur: lirePref(cle, lire, defaut) }))
  // autre utilisateur (ou identité chargée après coup) : relire son propre réglage
  const valeur = etat.cle === cle ? etat.valeur : lirePref(cle, lire, defaut)
  if (etat.cle !== cle) setEtat({ cle, valeur })
  const modifie = useRef(false)
  useEffect(() => {
    if (!id) return
    let fini = false
    modifie.current = false
    api<{ valeur?: unknown }>(`/auth/preferences/${nom}`)
      .then((rep) => {
        if (fini || modifie.current) return // changé entre-temps : le réglage de l'écran prime
        const { lire: lec, defaut: def } = outils.current
        if (enAttente(cle)) {
          envoyer(cle, lirePref(cle, lec, def)) // dernier envoi non reçu : le renvoyer plutôt que l'écraser
        } else if (rep.valeur === null) {
          // rien sur le serveur : reprendre le réglage fait avant dans ce navigateur
          const local = copieLocale(cle, lec)
          if (local !== null) envoyer(cle, local)
        } else if (rep.valeur !== undefined) {
          const v = lec(rep.valeur)
          if (v === null) return
          ecrirePref(cle, v, def)
          setEtat({ cle, valeur: v })
        }
      })
      .catch(() => {
        /* serveur injoignable : la copie du navigateur fait foi */
      })
    return () => {
      fini = true
    }
  }, [cle, id, nom])
  useEffect(() => {
    // réglage modifié dans un autre onglet : le suivre sans recharger
    const suivre = (e: StorageEvent) => {
      if (e.key === null || e.key === CLE + cle) {
        modifie.current = true // une lecture du serveur encore en route ne doit pas l'écraser
        const { lire: lec, defaut: def } = outils.current
        setEtat({ cle, valeur: lirePref(cle, lec, def) })
      }
    }
    window.addEventListener('storage', suivre)
    return () => window.removeEventListener('storage', suivre)
  }, [cle])
  const changer = (v: T) => {
    setEtat({ cle, valeur: v })
    ecrirePref(cle, v, outils.current.defaut)
    modifie.current = true
    if (id) envoyer(cle, v)
  }
  return [valeur, changer]
}
