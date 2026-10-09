/**
 * Borne la hauteur d'un panneau dont le tableau s'étire sur la hauteur disponible : le navigateur répartit
 * l'espace au prorata des lignes, la plus haute ne doit pas dépasser --ligne-max (défini au-dessus de 1100 px).
 */
export function plafonner(panneau: HTMLElement) {
  const table = panneau.querySelector<HTMLElement>('.panneau-corps > table')
  const racine = getComputedStyle(document.documentElement)
  const plafond = parseFloat(racine.getPropertyValue('--ligne-max')) * parseFloat(racine.fontSize)
  panneau.style.maxHeight = ''
  if (!table || !plafond) return
  // Hauteurs naturelles, tableau non étiré
  table.style.height = 'auto'
  const lignes = [...table.querySelectorAll('tbody tr')].map((r) => r.getBoundingClientRect().height)
  const tete = table.querySelector('thead')?.getBoundingClientRect().height ?? 0
  table.style.height = ''
  const haute = Math.max(...lignes)
  if (!lignes.length || !haute) return
  const corps = panneau.querySelector('.panneau-corps')!.getBoundingClientRect().height
  const autour = panneau.getBoundingClientRect().height - corps
  const total = lignes.reduce((a, b) => a + b, 0)
  panneau.style.maxHeight = `${Math.floor(autour + tete + (total * plafond) / haute)}px`
}
