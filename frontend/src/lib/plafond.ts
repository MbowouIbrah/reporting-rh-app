/**
 * Borne la hauteur d'un panneau dont le tableau s'étire sur la hauteur disponible :
 * - S'il y a assez d'espace, le tableau grandit pour afficher toutes ses lignes sans défilement (scroll).
 * - La hauteur de ligne ne doit pas dépasser --ligne-max pour ne pas rendre l'affichage trop grossier.
 * - Si le contenu dépasse l'espace disponible, le tableau garde sa hauteur naturelle et c'est la section qui défile.
 *
 * Tous les panneaux sont traités en lot : toutes les écritures, une seule série de lectures (une mise en page),
 * puis toutes les écritures finales. Alterner lecture et écriture panneau par panneau forçait une mise en page
 * complète à chaque fois.
 */
export function plafonnerTout(panneaux: Iterable<HTMLElement>) {
  const liste = [...panneaux]
  if (!liste.length) return
  const racine = getComputedStyle(document.documentElement)
  const plafond = parseFloat(racine.getPropertyValue('--ligne-max')) * parseFloat(racine.fontSize)

  // 1. Écritures : hauteurs naturelles, tableau non étiré
  const tables = liste.map((panneau) => {
    panneau.style.maxHeight = ''
    panneau.style.height = ''
    const table = panneau.querySelector<HTMLElement>('.panneau-corps > table')
    if (table && plafond) table.style.height = 'auto'
    return table
  })
  if (!plafond) return

  // 2. Lectures (une seule mise en page pour tous les panneaux)
  const mesures = liste.map((panneau, i) => {
    const table = tables[i]
    if (!table) return null
    const lignes = [...table.querySelectorAll('tbody tr')].map((r) => r.getBoundingClientRect().height)
    const tete = table.querySelector('thead')?.getBoundingClientRect().height ?? 0
    const pied = table.querySelector('tfoot')?.getBoundingClientRect().height ?? 0
    // Ligne de référence prise hors lignes de total figées (plus hautes), sinon le tableau s'étire moins
    const courantes = [...table.querySelectorAll('tbody:not(.pied) tr')].map((r) => r.getBoundingClientRect().height)
    const haute = Math.max(...(courantes.length ? courantes : lignes))
    if (!lignes.length || !haute) return null

    const h3 = panneau.querySelector('h3')?.getBoundingClientRect().height ?? 0
    const cs = getComputedStyle(panneau)
    const bordures = parseFloat(cs.borderTopWidth || '0') + parseFloat(cs.borderBottomWidth || '0')
    const section = panneau.closest<HTMLElement>('.snap-section')
    let dispoSection: number | null = null
    if (section) {
      // Hauteur utile : sans les marges internes, sinon le panneau dépasse et une barre de défilement apparaît pour rien
      const ss = getComputedStyle(section)
      dispoSection = Math.max(0, section.clientHeight - parseFloat(ss.paddingTop || '0') - parseFloat(ss.paddingBottom || '0'))
    }
    return { lignes, tete, pied, haute, autour: h3 + bordures, dispoSection, colonne: !!panneau.closest('.snap-colonne') }
  })

  // 3. Écritures finales
  tables.forEach((t) => {
    if (t) t.style.height = ''
  })
  mesures.forEach((m, i) => {
    if (!m) return
    const panneau = liste[i]
    const total = m.lignes.reduce((a, b) => a + b, 0)
    // Hauteur minimale pour afficher toutes les lignes sans scrollbar (+ marge de sécurité de 4px)
    const besoinNaturel = m.autour + m.tete + m.pied + total + 4
    // Hauteur étirée maximale autorisée selon --ligne-max (évite d'étirer démesurément peu de lignes)
    const maxEtire = m.autour + m.tete + m.pied + (total * plafond) / m.haute + 4
    const cible = Math.max(besoinNaturel, maxEtire)

    if (m.dispoSection !== null && !m.colonne) {
      // Panneau seul dans la section (ex: Sites, Services) : il prend la hauteur de la cible
      // (lignes étirées jusqu'à --ligne-max), bornée par la section, jamais sous sa hauteur naturelle.
      const h = m.dispoSection > 0 ? Math.max(besoinNaturel, Math.min(cible, m.dispoSection)) : cible
      panneau.style.height = `${Math.floor(h)}px`
      panneau.style.maxHeight = `${Math.floor(h)}px`
    } else {
      panneau.style.maxHeight = `${Math.ceil(cible)}px`
    }
  })
}

/** Un seul panneau (voir plafonnerTout). */
export function plafonner(panneau: HTMLElement) {
  plafonnerTout([panneau])
}

/** Nombre de lignes occupées par le texte d'une cellule. */
function lignesTexte(cellule: HTMLElement) {
  const r = document.createRange()
  r.selectNodeContents(cellule)
  if (typeof r.getClientRects !== 'function') return 0 // environnement sans mise en page (tests)
  return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size
}

const LARGEUR_MAX = 480
const PAS = 8

/**
 * En-têtes de tableau sur deux lignes au plus : élargit chaque colonne (hors colonnes figées) juste ce qu'il faut,
 * par pas de 8 px à partir de sa largeur naturelle (au plus 480 px).
 * Toutes les colonnes sont cherchées à la fois : une mise en page par tour (quelques tours)
 * au lieu d'une par pas de 8 px et par colonne.
 */
export function entetesDeuxLignes(table: HTMLElement) {
  const ths = [...table.querySelectorAll<HTMLElement>('thead th:not(.fige-g):not(.fige-d1)')]
  ths.forEach((th) => (th.style.minWidth = ''))
  const base = ths.map((th) => th.getBoundingClientRect().width)
  const nbLignes = ths.map(lignesTexte)
  // Pour chaque colonne trop haute : nombre de pas k cherché dans ]bas, haut], haut = dernier pas autorisé
  const cherche = ths
    .map((_, i) => i)
    .filter((i) => nbLignes[i] > 2 && base[i] < LARGEUR_MAX)
    .map((i) => ({ i, bas: 0, haut: Math.ceil((LARGEUR_MAX - base[i]) / PAS) }))
  const largeur = (i: number, k: number) => `${Math.ceil(base[i] + k * PAS)}px`

  // Tant qu'aucun pas essayé ne suffit, on double l'essai (1, 2, 4… pas) : peu de tours quand il faut peu
  // d'élargissement ; ensuite dichotomie entre le dernier essai trop étroit et le premier suffisant
  const borne = new Map(cherche.map((c) => [c, false]))
  let actifs = cherche.filter((c) => c.haut - c.bas > 1)
  while (actifs.length) {
    const milieux = actifs.map((c) => (borne.get(c) ? Math.floor((c.bas + c.haut) / 2) : Math.min(c.haut - 1, Math.max(1, c.bas * 2))))
    actifs.forEach((c, j) => (ths[c.i].style.minWidth = largeur(c.i, milieux[j])))
    const ok = actifs.map((c) => lignesTexte(ths[c.i]) <= 2)
    actifs.forEach((c, j) => {
      if (ok[j]) {
        c.haut = milieux[j]
        borne.set(c, true)
      } else c.bas = milieux[j]
    })
    actifs = actifs.filter((c) => c.haut - c.bas > 1)
  }
  cherche.forEach((c) => (ths[c.i].style.minWidth = largeur(c.i, c.haut)))
}
