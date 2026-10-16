/**
 * Filtres communs à toutes les pages (année, mois, service, site, type de site, poste, activité, employé, comparaison) :
 * une valeur choisie sur une page s'affiche à l'identique sur les autres. Conservés le temps
 * de la session du navigateur ; l'URL de la page courante en garde une copie (lien partageable).
 */
export const CLES_PARTAGEES = ['annee', 'mois', 'service', 'site', 'type_site', 'poste', 'activite', 'matricule', 'cmp_annee', 'cmp_periode'] as const
export type ClePartagee = (typeof CLES_PARTAGEES)[number]
export type Partage = Partial<Record<ClePartagee, string>>
export type Patch = Partial<Record<ClePartagee, string | number | undefined>>

const STOCKAGE = 'reporting-rh:filtres'

function lire(): Partage {
  try {
    const brut = JSON.parse(sessionStorage.getItem(STOCKAGE) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(CLES_PARTAGEES.filter((k) => typeof brut[k] === 'string').map((k) => [k, brut[k]]))
  } catch {
    return {}
  }
}

let etat: Partage = lire()
const abonnes = new Set<() => void>()

export const lirePartage = () => etat

export function abonnerPartage(f: () => void) {
  abonnes.add(f)
  return () => {
    abonnes.delete(f)
  }
}

export function modifierPartage(patch: Patch) {
  const suivant: Partage = { ...etat }
  let change = false
  for (const [k, v] of Object.entries(patch) as [ClePartagee, Patch[ClePartagee]][]) {
    const val = v === undefined || v === '' ? undefined : String(v)
    if (suivant[k] === val) continue
    change = true
    if (val === undefined) delete suivant[k]
    else suivant[k] = val
  }
  if (!change) return
  etat = suivant
  try {
    sessionStorage.setItem(STOCKAGE, JSON.stringify(etat))
  } catch {
    /* stockage indisponible : le partage vaut pour l'onglet courant */
  }
  abonnes.forEach((f) => f())
}

/** Tests : repart d'un état vide. */
export function viderPartage() {
  etat = {}
  try {
    sessionStorage.removeItem(STOCKAGE)
  } catch {
    /* rien */
  }
}
