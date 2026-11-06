/**
 * Borne la hauteur d'un panneau dont le tableau s'étire sur la hauteur disponible :
 * - S'il y a assez d'espace, le tableau grandit pour afficher toutes ses lignes sans défilement (scroll).
 * - La hauteur de ligne ne doit pas dépasser --ligne-max pour ne pas rendre l'affichage trop grossier.
 * - Si le contenu dépasse l'espace disponible, le tableau garde sa hauteur naturelle et c'est la section qui défile.
 */
export function plafonner(panneau: HTMLElement) {
  const table = panneau.querySelector<HTMLElement>('.panneau-corps > table')
  const racine = getComputedStyle(document.documentElement)
  const plafond = parseFloat(racine.getPropertyValue('--ligne-max')) * parseFloat(racine.fontSize)
  panneau.style.maxHeight = ''
  panneau.style.height = ''
  if (!table || !plafond) return

  // Hauteurs naturelles, tableau non étiré
  table.style.height = 'auto'
  const lignes = [...table.querySelectorAll('tbody tr')].map((r) => r.getBoundingClientRect().height)
  const tete = table.querySelector('thead')?.getBoundingClientRect().height ?? 0
  const pied = table.querySelector('tfoot')?.getBoundingClientRect().height ?? 0
  // Ligne de référence prise hors lignes de total figées (plus hautes), sinon le tableau s'étire moins
  const courantes = [...table.querySelectorAll('tbody:not(.pied) tr')].map((r) => r.getBoundingClientRect().height)
  table.style.height = ''
  const haute = Math.max(...(courantes.length ? courantes : lignes))
  if (!lignes.length || !haute) return

  const h3 = panneau.querySelector('h3')?.getBoundingClientRect().height ?? 0
  const cs = getComputedStyle(panneau)
  const bordures = parseFloat(cs.borderTopWidth || '0') + parseFloat(cs.borderBottomWidth || '0')
  const autour = h3 + bordures

  const total = lignes.reduce((a, b) => a + b, 0)
  // Hauteur minimale pour afficher toutes les lignes sans scrollbar (+ marge de sécurité de 4px)
  const besoinNaturel = autour + tete + pied + total + 4
  // Hauteur étirée maximale autorisée selon --ligne-max (évite d'étirer démesurément peu de lignes)
  const maxEtire = autour + tete + pied + (total * plafond) / haute + 4
  const cible = Math.max(besoinNaturel, maxEtire)

  // Vérifier l'espace vertical disponible dans la section
  const section = panneau.closest<HTMLElement>('.snap-section')
  if (section) {
    // Hauteur utile : sans les marges internes, sinon le panneau dépasse et une barre de défilement apparaît pour rien
    const ss = getComputedStyle(section)
    const dispoSection = Math.max(0, section.clientHeight - parseFloat(ss.paddingTop || '0') - parseFloat(ss.paddingBottom || '0'))

    const colonne = panneau.closest<HTMLElement>('.snap-colonne')
    if (colonne) {
      panneau.style.maxHeight = `${Math.ceil(cible)}px`
    } else {
      // Panneau seul dans la section (ex: Sites, Services) : il prend la hauteur de la cible
      // (lignes étirées jusqu'à --ligne-max), bornée par la section, jamais sous sa hauteur naturelle.
      const h = dispoSection > 0 ? Math.max(besoinNaturel, Math.min(cible, dispoSection)) : cible
      panneau.style.height = `${Math.floor(h)}px`
      panneau.style.maxHeight = `${Math.floor(h)}px`
    }
  } else {
    panneau.style.maxHeight = `${Math.ceil(cible)}px`
  }
}

/** Nombre de lignes occupées par le texte d'une cellule. */
function lignesTexte(cellule: HTMLElement) {
  const r = document.createRange()
  r.selectNodeContents(cellule)
  if (typeof r.getClientRects !== 'function') return 0 // environnement sans mise en page (tests)
  return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size
}

/** En-têtes de tableau sur deux lignes au plus : élargit chaque colonne (hors colonnes figées) juste ce qu'il faut. */
export function entetesDeuxLignes(table: HTMLElement) {
  table.querySelectorAll<HTMLElement>('thead th:not(.fige-g):not(.fige-d1)').forEach((th) => {
    th.style.minWidth = ''
    let w = th.getBoundingClientRect().width
    while (lignesTexte(th) > 2 && w < 480) {
      w += 8
      th.style.minWidth = `${Math.ceil(w)}px`
    }
  })
}
