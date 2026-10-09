import type { Ligne } from '../../../lib/grille'

/** Brouillon de grille gardé dans le navigateur, par mois : confort local, jamais la source de vérité. */
export interface Brouillon {
  id: string
  lignes: Ligne[]
  date?: string
}

/** Un brouillon n'a de valeur que si un montant a été saisi : matricules et noms préremplis seuls n'en font pas un. */
export const aSaisie = (lignes: Ligne[]) =>
  lignes.some((l) => Object.entries(l).some(([k, v]) => k.startsWith('r:') && typeof v === 'string' && v.trim() !== ''))

export const cleBrouillon = (annee: number, mois: number) => `saisie:${annee}-${String(mois).padStart(2, '0')}`

export function lireBrouillon(cle: string): Brouillon | null {
  try {
    const b = JSON.parse(localStorage.getItem(cle) ?? 'null') as Brouillon | null
    return b && typeof b.id === 'string' && Array.isArray(b.lignes) && aSaisie(b.lignes) ? b : null
  } catch {
    return null
  }
}

export function ecrireBrouillon(cle: string, b: Brouillon) {
  try {
    localStorage.setItem(cle, JSON.stringify({ ...b, date: new Date().toISOString() }))
  } catch {
    /* stockage indisponible : la saisie continue sans brouillon */
  }
}

export function effacerBrouillon(cle: string) {
  try {
    localStorage.removeItem(cle)
  } catch {
    /* idem */
  }
}

export const nouveauBrouillonId = () =>
  globalThis.crypto?.randomUUID?.() ?? `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
