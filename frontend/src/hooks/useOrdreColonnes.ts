import { useState, type DragEvent, type KeyboardEvent } from 'react'

export interface Colonne {
  colonne: string
  exclu: boolean
}

/** Colonnes exclues du TOTAL d'abord (bloc hachuré), puis les comptées, chaque bloc dans l'ordre reçu. */
export function grouper(ordre: string[], exclues: Set<string>): string[] {
  return [...ordre.filter((c) => exclues.has(c)), ...ordre.filter((c) => !exclues.has(c))]
}

/** Place la colonne `c` à la position de `cible` (avant elle vers la gauche, après elle vers la droite). */
export function deplacer(liste: string[], c: string, cible: string): string[] {
  const i = liste.indexOf(cible)
  if (c === cible || i < 0 || !liste.includes(c)) return liste
  const reste = liste.filter((x) => x !== c)
  reste.splice(i, 0, c)
  return reste
}

/** Dépôt de `c` sur `cible` : nouvel ordre, et `c` prend la zone de la cible (hachurée ou comptée). */
export function deposer(ordre: string[], exclues: Set<string>, c: string, cible: string): Colonne[] {
  const exclu = exclues.has(cible)
  return deplacer(ordre, c, cible).map((x) => ({ colonne: x, exclu: x === c ? exclu : exclues.has(x) }))
}

/**
 * Ordre et zone hachurée des colonnes, communs à tous (servis par le serveur). Qui a le droit glisse
 * l'en-tête (ou Alt + ← / → au clavier) : un simple déplacement s'enregistre aussitôt, un changement
 * de zone (entrée ou sortie du TOTAL) attend une confirmation. Sans droit, les en-têtes sont fixes.
 */
export function useOrdreColonnes(
  colonnes: string[],
  exclues: Set<string>,
  { modifiable, enregistrer }: { modifiable: boolean; enregistrer: (l: Colonne[]) => Promise<unknown> },
) {
  const base = [...colonnes, '|', ...exclues].join('\u0000')
  // Proposition affichée en attendant le serveur ; ignorée dès que les colonnes servies changent.
  const [propose, setPropose] = useState<{ base: string; liste: Colonne[] } | null>(null)
  const [attente, setAttente] = useState<{ liste: Colonne[]; colonne: Colonne } | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [glisse, setGlisse] = useState<string | null>(null)
  const [cible, setCible] = useState<string | null>(null)

  const liste = propose?.base === base ? propose.liste : null
  const zone = liste ? new Set(liste.filter((x) => x.exclu).map((x) => x.colonne)) : exclues
  const ordre = liste ? grouper(liste.map((x) => x.colonne), zone) : grouper(colonnes, exclues)

  const envoyer = (l: Colonne[]) => {
    setErreur(null)
    setPropose({ base, liste: l })
    enregistrer(l).catch((e: unknown) => {
      setPropose(null)
      setErreur(e instanceof Error ? e.message : 'Enregistrement impossible')
    })
  }
  const proposer = (c: string, sur: string) => {
    if (c === sur) return
    const l = deposer(ordre, zone, c, sur)
    const colonne = l.find((x) => x.colonne === c)!
    if (colonne.exclu === zone.has(c)) envoyer(l)
    else setAttente({ liste: l, colonne })
  }
  const fin = () => {
    setGlisse(null)
    setCible(null)
  }

  /** Propriétés à poser sur l'en-tête de la colonne `c`. */
  const entete = (c: string) =>
    modifiable
      ? {
          draggable: true,
          tabIndex: 0,
          title: 'Glisser pour déplacer la colonne (Alt + ← / → au clavier)',
          'data-glisse': glisse === c || undefined,
          'data-cible': (glisse && glisse !== c && cible === c) || undefined,
          onDragStart: (e: DragEvent) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', c)
            setGlisse(c)
          },
          onDragOver: (e: DragEvent) => {
            if (!glisse) return
            e.preventDefault()
            if (cible !== c) setCible(c)
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault()
            if (glisse) proposer(glisse, c)
            fin()
          },
          onDragEnd: fin,
          onKeyDown: (e: KeyboardEvent) => {
            if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
            e.preventDefault()
            const voisin = ordre[ordre.indexOf(c) + (e.key === 'ArrowLeft' ? -1 : 1)]
            if (voisin) proposer(c, voisin)
          },
        }
      : {}

  return {
    ordre,
    exclues: zone,
    entete,
    erreur,
    /** Changement de zone en attente de confirmation. */
    attente: attente?.colonne ?? null,
    confirmer: () => {
      if (attente) envoyer(attente.liste)
      setAttente(null)
    },
    annuler: () => setAttente(null),
  }
}
