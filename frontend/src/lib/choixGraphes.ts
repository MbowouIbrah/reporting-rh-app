import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useMonId } from '../auth/AuthContext'

/** Choix des graphiques affichés, propre à chaque utilisateur : on mémorise la liste des graphiques
 *  masqués, pour qu'un graphique ajouté plus tard s'affiche d'office. Le serveur la garde
 *  (`/auth/preferences/graphes.<page>`, suivie sur tous les postes) ; le navigateur en garde une copie
 *  (clé `reporting-rh.graphes.<id utilisateur>.<page>`) pour l'affichage immédiat et les autres onglets. */
const CLE = 'reporting-rh.graphes.'

/** `cle` : `<id utilisateur>.<page>`. */
export function lireMasques(cle: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CLE + cle) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function ecrireMasques(cle: string, masques: string[]) {
  try {
    if (masques.length) localStorage.setItem(CLE + cle, JSON.stringify(masques))
    else localStorage.removeItem(CLE + cle)
  } catch {
    /* stockage indisponible : le choix vaut pour la page en cours seulement */
  }
}

const ATTENTE = '.attente'
const enCours = new Set<string>()
const aEnvoyer = new Map<string, string[]>()

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

/** Envois l'un après l'autre, seul le dernier choix en attente part : le serveur ne peut pas
 *  garder une liste plus ancienne que l'écran. En cas d'échec, le choix est renvoyé au prochain chargement. */
function envoyer(cle: string, masques: string[]) {
  marquer(cle, true)
  aEnvoyer.set(cle, masques)
  if (enCours.has(cle)) return
  enCours.add(cle)
  const suivant = () => {
    const m = aEnvoyer.get(cle)
    if (!m) {
      enCours.delete(cle)
      return
    }
    aEnvoyer.delete(cle)
    const page = cle.slice(cle.indexOf('.') + 1)
    api(`/auth/preferences/graphes.${page}`, { method: 'PUT', body: JSON.stringify({ valeur: m }) })
      .then(() => {
        if (!aEnvoyer.has(cle)) marquer(cle, false)
      })
      .catch(() => {
        /* échec : la marque reste, renvoi au prochain chargement */
      })
      .finally(suivant)
  }
  suivant()
}

export interface ChoixGraphes {
  masques: string[]
  visible: (id: string) => boolean
  basculer: (id: string) => void
  toutAfficher: () => void
}

export function useChoixGraphes(page = 'evolution'): ChoixGraphes {
  const id = useMonId() ?? 0
  const cle = `${id}.${page}`
  const [etat, setEtat] = useState(() => ({ cle, masques: lireMasques(cle) }))
  // autre utilisateur (ou identité chargée après coup) : relire son propre choix
  const masques = etat.cle === cle ? etat.masques : lireMasques(cle)
  if (etat.cle !== cle) setEtat({ cle, masques })
  const modifie = useRef(false)
  const courant = useRef(masques)
  courant.current = masques
  useEffect(() => {
    if (!id) return
    let fini = false
    modifie.current = false
    const chemin = `/auth/preferences/graphes.${page}`
    api<{ valeur?: unknown }>(chemin)
      .then(({ valeur }) => {
        if (fini || modifie.current) return // changé entre-temps : le choix de l'écran prime
        if (enAttente(cle)) {
          envoyer(cle, lireMasques(cle)) // dernier envoi non reçu : le renvoyer plutôt que l'écraser
        } else if (Array.isArray(valeur)) {
          const m = valeur.filter((x): x is string => typeof x === 'string')
          ecrireMasques(cle, m)
          setEtat({ cle, masques: m })
        } else if (valeur === null) {
          // rien sur le serveur : reprendre le choix fait avant dans ce navigateur
          const local = lireMasques(cle)
          if (local.length) envoyer(cle, local)
        }
      })
      .catch(() => {
        /* serveur injoignable : la copie du navigateur fait foi */
      })
    return () => {
      fini = true
    }
  }, [cle, id, page])
  useEffect(() => {
    // choix modifié dans un autre onglet : le suivre sans recharger
    const suivre = (e: StorageEvent) => {
      if (e.key === null || e.key === CLE + cle) {
        modifie.current = true // une lecture du serveur encore en route ne doit pas l'écraser
        setEtat({ cle, masques: lireMasques(cle) })
      }
    }
    window.addEventListener('storage', suivre)
    return () => window.removeEventListener('storage', suivre)
  }, [cle])
  const changer = (m: string[]) => {
    courant.current = m // deux clics avant le rendu suivant : le second part du premier
    setEtat({ cle, masques: m })
    ecrireMasques(cle, m)
    modifie.current = true
    if (id) envoyer(cle, m)
  }
  return {
    masques,
    visible: (g) => !masques.includes(g),
    basculer: (g) => {
      const m = courant.current
      changer(m.includes(g) ? m.filter((x) => x !== g) : [...m, g])
    },
    toutAfficher: () => changer([]),
  }
}
