import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { lireNoms } from './groupesGraphes'

type Noms = Record<string, string>

/** Noms des groupes d'origine choisis par l'administration, vus par tous (`/reglages/noms_groupes`).
 *  Lecture impossible : aucun nom choisi (noms par défaut). L'enregistrement échoue si le serveur refuse. */
export function useNomsGroupes(): [Noms, (n: Noms) => Promise<void>] {
  const [noms, setNoms] = useState<Noms>({})
  useEffect(() => {
    let actif = true
    api<{ valeur: unknown }>('/reglages/noms_groupes')
      .then((r) => {
        if (actif) setNoms(lireNoms(r.valeur) ?? {})
      })
      .catch(() => {
        if (actif) setNoms({})
      })
    return () => {
      actif = false
    }
  }, [])
  const enregistrer = useCallback(async (n: Noms) => {
    const r = await api<{ valeur: unknown }>('/reglages/noms_groupes', {
      method: 'PUT',
      body: JSON.stringify({ valeur: n }),
    })
    setNoms(lireNoms(r.valeur) ?? {})
  }, [])
  return [noms, enregistrer]
}
