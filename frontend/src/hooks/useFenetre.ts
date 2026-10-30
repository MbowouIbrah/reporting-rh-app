import { useLayoutEffect, useState } from 'react'

const HAUTEUR_DEFAUT = 22
const MARGE = 15

/** Lignes [debut, fin) à rendre pour la zone visible, plus une marge de chaque côté.
    debut reste pair : l'alternance des lignes (nth-child) ne saute pas au défilement. */
export function tranche(defile: number, vue: number, hauteur: number, total: number, marge = MARGE) {
  const h = Math.max(1, hauteur)
  const fin = Math.min(total, Math.ceil((Math.max(0, defile) + vue) / h) + marge)
  let debut = Math.min(Math.max(0, Math.floor(defile / h) - marge), Math.max(0, fin - 1))
  debut -= debut % 2
  return { debut, fin }
}

/** Rendu fenêtré d'un long tableau : seules les lignes proches de la zone visible existent dans le DOM.
    `ref` se pose sur le conteneur qui défile ; les lignes mesurées sont celles de `tbody.fenetre`. */
export function useFenetre(total: number) {
  const [corps, ref] = useState<HTMLElement | null>(null)
  const [mesure, setMesure] = useState({ defile: 0, vue: 0, hauteur: HAUTEUR_DEFAUT })

  useLayoutEffect(() => {
    if (!corps) return
    let image = 0
    const lire = () => {
      image = 0
      const entete = corps.querySelector<HTMLElement>('thead')?.offsetHeight ?? 0
      const ligne = corps.querySelector<HTMLElement>('tbody.fenetre > tr')?.offsetHeight
      // Conteneur sans hauteur bornée (écran étroit) : c'est la page qui défile, la zone visible
      // est celle de la fenêtre ; sinon le conteneur grandit avec les lignes et les rend toutes.
      const haut = corps.getBoundingClientRect().top
      const suivante = {
        defile: corps.scrollTop + Math.max(0, -haut) - entete,
        vue: Math.min(corps.clientHeight || window.innerHeight, window.innerHeight),
        hauteur: ligne || HAUTEUR_DEFAUT,
      }
      setMesure((m) => (m.defile === suivante.defile && m.vue === suivante.vue && m.hauteur === suivante.hauteur ? m : suivante))
    }
    const planifier = (e?: unknown) => {
      // Défilement sans effet sur la position du tableau (autre liste de la page) : ignoré.
      const cible = e instanceof Event && e.type === 'scroll' ? e.target : null
      if (cible && cible !== document && !(cible instanceof Node && cible.contains(corps))) return
      if (!image) image = requestAnimationFrame(lire)
    }
    lire()
    // Capture : défilement du conteneur comme de la page ou d'un ancêtre.
    document.addEventListener('scroll', planifier, { capture: true, passive: true })
    window.addEventListener('resize', planifier)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(planifier)
    ro?.observe(corps)
    if (corps.firstElementChild) ro?.observe(corps.firstElementChild)
    return () => {
      document.removeEventListener('scroll', planifier, { capture: true })
      window.removeEventListener('resize', planifier)
      ro?.disconnect()
      cancelAnimationFrame(image)
    }
  }, [corps, total])

  const { debut, fin } = tranche(mesure.defile, mesure.vue, mesure.hauteur, total)
  return { ref, debut, fin, avant: debut * mesure.hauteur, apres: (total - fin) * mesure.hauteur }
}
