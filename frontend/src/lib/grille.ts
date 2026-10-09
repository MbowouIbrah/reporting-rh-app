/** Logique pure de la grille de saisie : montants en texte, collage depuis Excel. */

// Même motif que RE_NOMBRE côté serveur (app/imports/regles.py) : milliers séparés par une espace.
const RE_NOMBRE = /^-?\d{1,3}(?: ?\d{3})*(?:[.,]\d+)?$|^-?\d+(?:[.,]\d+)?$/

/** Espaces insécables (Excel, format français) ramenées à une espace simple. */
export const nettoyer = (s: string) => s.replace(/[   ]/g, ' ').trim()

/** Montant acceptable par le serveur ? Vide = pas de montant, donc valide. Jamais converti en nombre. */
export function estMontant(s: string): boolean {
  const t = nettoyer(s)
  if (!t) return true
  return RE_NOMBRE.test(t) && !(t.includes(',') && t.includes('.'))
}

/**
 * Texte copié depuis Excel (TSV) -> tableau de cellules.
 * Gère \r\n, la ligne vide finale ajoutée par Excel et les cellules entre guillemets (retours à la ligne).
 */
export function lireTSV(texte: string): string[][] {
  const lignes: string[][] = []
  let ligne: string[] = []
  let cell = ''
  let i = 0
  const t = texte.replace(/\r\n?/g, '\n')
  while (i < t.length) {
    const c = t[i]
    if (c === '"' && cell === '') {
      // cellule entre guillemets : jusqu'au guillemet fermant, "" = guillemet littéral
      let j = i + 1
      let v = ''
      while (j < t.length) {
        if (t[j] === '"' && t[j + 1] === '"') { v += '"'; j += 2 } else if (t[j] === '"') { j++; break } else v += t[j++]
      }
      if (j >= t.length || t[j] === '\t' || t[j] === '\n') { cell = v; i = j; continue }
      cell = c // guillemet non fermant : texte littéral
      i++
      continue
    }
    if (c === '\t') { ligne.push(cell); cell = '' } else if (c === '\n') { ligne.push(cell); lignes.push(ligne); ligne = []; cell = '' } else cell += c
    i++
  }
  if (cell !== '' || ligne.length) { ligne.push(cell); lignes.push(ligne) }
  return lignes
}

export type Ligne = Record<string, string>

/**
 * Colle un bloc à partir de la cellule (r0, c0). Les cellules en lecture seule sont sautées,
 * les lignes manquantes sont créées par `nouvelle`, les colonnes au-delà de la dernière ignorées.
 */
export function coller(
  lignes: Ligne[],
  r0: number,
  c0: number,
  bloc: string[][],
  colonnes: string[],
  modifiable: (l: Ligne, col: string) => boolean,
  nouvelle: () => Ligne,
): Ligne[] {
  const out = lignes.slice()
  bloc.forEach((valeurs, k) => {
    const r = r0 + k
    if (r >= out.length) out.push(nouvelle())
    const l = { ...out[r] }
    valeurs.forEach((v, j) => {
      const col = colonnes[c0 + j]
      if (col !== undefined && modifiable(l, col)) l[col] = nettoyer(v)
    })
    out[r] = l
  })
  return out
}
