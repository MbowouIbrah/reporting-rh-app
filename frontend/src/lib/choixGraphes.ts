import { useEffect, useState } from 'react'
import { useMonId } from '../auth/AuthContext'

/** Choix des graphiques affichés, propre à chaque utilisateur dans ce navigateur (clé
 *  `reporting-rh.graphes.<id utilisateur>.<page>`) : on mémorise la liste des graphiques masqués,
 *  pour qu'un graphique ajouté plus tard s'affiche d'office. */
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

export interface ChoixGraphes {
  masques: string[]
  visible: (id: string) => boolean
  basculer: (id: string) => void
  toutAfficher: () => void
}

export function useChoixGraphes(page = 'evolution'): ChoixGraphes {
  const cle = `${useMonId() ?? 0}.${page}`
  const [etat, setEtat] = useState(() => ({ cle, masques: lireMasques(cle) }))
  // autre utilisateur (ou identité chargée après coup) : relire son propre choix
  const masques = etat.cle === cle ? etat.masques : lireMasques(cle)
  if (etat.cle !== cle) setEtat({ cle, masques })
  useEffect(() => {
    // choix modifié dans un autre onglet : le suivre sans recharger
    const suivre = (e: StorageEvent) => {
      if (e.key === null || e.key === CLE + cle) setEtat({ cle, masques: lireMasques(cle) })
    }
    window.addEventListener('storage', suivre)
    return () => window.removeEventListener('storage', suivre)
  }, [cle])
  const changer = (m: string[]) => {
    setEtat({ cle, masques: m })
    ecrireMasques(cle, m)
  }
  return {
    masques,
    visible: (id) => !masques.includes(id),
    basculer: (id) => changer(masques.includes(id) ? masques.filter((x) => x !== id) : [...masques, id]),
    toutAfficher: () => changer([]),
  }
}
