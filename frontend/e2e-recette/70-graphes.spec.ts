import { expect, type Page, test } from '@playwright/test'
import { ADMIN, connecter } from './outils'

const MASQUES = ['Salaire par mois (FCFA)', 'Absences par mois (jours)']
const GARDE = 'Primes par mois (FCFA)'

const graphe = (page: Page, titre: string) => page.locator('figure.graphe figcaption', { hasText: titre })

test('choix des graphiques : masqués après rechargement, sur un autre poste et absents du PDF', async ({ page, browser }) => {
  test.setTimeout(60_000)
  await connecter(page, ADMIN)
  await page.goto('graphes')
  const menu = page.locator('details.choix-graphes')
  await expect(menu).toBeVisible()
  for (const t of [...MASQUES, GARDE]) await expect(graphe(page, t)).toHaveCount(1)

  await menu.locator('summary').click()
  for (const t of MASQUES) await page.getByRole('checkbox', { name: t }).uncheck()
  for (const t of MASQUES) await expect(graphe(page, t)).toHaveCount(0)

  await page.reload()
  await expect(graphe(page, GARDE)).toHaveCount(1)
  for (const t of MASQUES) await expect(graphe(page, t)).toHaveCount(0)

  // Autre poste (navigateur vierge) : le choix gardé sur le serveur suit l'utilisateur
  const autre = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const poste = await autre.newPage()
  await connecter(poste, ADMIN)
  await poste.goto('graphes')
  const figure = (t: string) => poste.getByRole('figure', { name: t, exact: true })
  await expect(figure(GARDE)).toHaveCount(1, { timeout: 20_000 })
  for (const t of MASQUES) await expect(figure(t)).toHaveCount(0)
  await autre.close()

  // Le PDF s'ouvre dans le même navigateur : il suit le choix, sans le menu
  await page.goto('rapport?sections=graphes')
  await expect(graphe(page, GARDE)).toHaveCount(1, { timeout: 20_000 })
  for (const t of MASQUES) await expect(graphe(page, t)).toHaveCount(0)
  await expect(page.locator('details.choix-graphes')).toHaveCount(0)

  await page.goto('graphes')
  await page.locator('details.choix-graphes summary').click()
  await page.getByRole('button', { name: 'Tout afficher' }).click()
  for (const t of MASQUES) await expect(graphe(page, t)).toHaveCount(1)
})
