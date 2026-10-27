import { useEffect, useState } from 'react'

/** Rythme du squelette, à garder égal à --sk-delai et --sk-cycle (styles/base.css). */
export const DELAI_SQUELETTE = 300
export const CYCLE_SQUELETTE = 1200

/** Fin de l'attente : une réponse arrivée avant le délai n'a jamais montré le squelette (0) ; sinon le squelette
 *  finit son cycle en cours, et au moins un cycle complet (jamais coupé au milieu d'une pulsation). */
export function finAttente(debut: number, maintenant: number): number {
  const visible = maintenant - debut - DELAI_SQUELETTE
  if (visible <= 0) return 0
  return debut + DELAI_SQUELETTE + Math.ceil(visible / CYCLE_SQUELETTE) * CYCLE_SQUELETTE
}

interface Suivi {
  debut: number | null
  fin: number | null
}

/** Attente affichée pour un chargement : vraie tant que `occupe`, puis jusqu'à la fin du cycle du squelette.
 *  Le second terme (relais) passe à vrai quand le contenu remplace un squelette resté visible : la page ne
 *  rejoue alors pas son entrée, seules les valeurs apparaissent en fondu. */
export function useAttente(occupe: boolean): [boolean, boolean] {
  const [s, setS] = useState<Suivi>({ debut: null, fin: null })
  const [relais, setRelais] = useState(false)
  // Ajusté pendant le rendu : le contenu n'est jamais monté puis remplacé par le squelette (pas de saut d'image).
  if (occupe && (s.debut === null || s.fin !== null)) {
    // Reprise pendant la fin de cycle : le squelette n'a pas quitté l'écran, son rythme continue.
    setS({ debut: s.debut ?? Date.now(), fin: null })
  } else if (!occupe && s.debut !== null && s.fin === null) {
    const fin = finAttente(s.debut, Date.now())
    setS(fin ? { debut: s.debut, fin } : { debut: null, fin: null })
  }
  useEffect(() => {
    if (occupe || s.fin === null) return
    const id = setTimeout(() => {
      setS({ debut: null, fin: null })
      setRelais(true)
    }, Math.max(0, s.fin - Date.now()))
    return () => clearTimeout(id)
  }, [occupe, s.fin])
  return [occupe || s.fin !== null, relais]
}
