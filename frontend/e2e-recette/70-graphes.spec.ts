import { expect, type Page, test } from '@playwright/test'
import { ADMIN, connecter } from './outils'

const NOM = 'Recette salaires'
const TITRE = 'Salaire par mois (FCFA)'

const graphe = (page: Page, titre: string) => page.locator('figure.graphe figcaption', { hasText: titre })
const menu = (page: Page) => page.locator('details.menu-groupes')

async function choisir(page: Page, nom: RegExp | string) {
  await menu(page).locator('summary').click()
  await menu(page).getByRole('button', { name: nom }).click()
}

test('groupes de graphiques : quatre cartes au plus, tous les groupes, groupe personnel gardé et suivi sur un autre poste', async ({ page, browser }) => {
  test.setTimeout(90_000)
  await connecter(page, ADMIN)
  await page.goto('graphes')
  await expect(menu(page)).toBeVisible()

  // Ouverture sur le premier groupe : quatre cartes au plus
  await expect(menu(page).locator('summary')).toContainText('Groupe : ')
  await expect(page.locator('figure.graphe').first()).toBeVisible()
  expect(await page.locator('figure.graphe').count()).toBeLessThanOrEqual(4)

  // Un autre groupe remplace le premier
  await choisir(page, /Salaires, primes et charges/)
  await expect(graphe(page, TITRE)).toHaveCount(1)
  await expect(graphe(page, 'Masse salariale mensuelle')).toHaveCount(0)
  expect(await page.locator('figure.graphe').count()).toBeLessThanOrEqual(4)

  // Tous les groupes : un écran par groupe, toutes les cartes sont dans la page
  await choisir(page, /Tout afficher/)
  await expect(page.locator('.snap-section').first()).toBeVisible()
  expect(await page.locator('.snap-section').count()).toBeGreaterThan(1)
  await expect(graphe(page, TITRE)).toHaveCount(1)
  await expect(graphe(page, 'Masse salariale mensuelle')).toHaveCount(1)

  // Groupe personnel : créé dans « Personnaliser… », il s'affiche et reste après rechargement
  await menu(page).locator('summary').click()
  await menu(page).getByRole('button', { name: 'Personnaliser…' }).click()
  const fenetre = page.locator('dialog.perso-groupes')
  await expect(fenetre).toBeVisible()
  await fenetre.getByRole('button', { name: 'Nouveau groupe' }).click()
  await fenetre.getByLabel('Nom du groupe').fill(NOM)
  await fenetre.getByRole('checkbox', { name: TITRE }).check()
  await fenetre.getByRole('button', { name: 'Valider' }).click()
  await fenetre.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(fenetre).toHaveCount(0)

  await choisir(page, new RegExp(NOM))
  await expect(menu(page).locator('summary')).toContainText(`Groupe : ${NOM}`)
  await expect(page.locator('figure.graphe')).toHaveCount(1)
  await expect(graphe(page, TITRE)).toHaveCount(1)

  await page.reload()
  await choisir(page, new RegExp(NOM))
  await expect(graphe(page, TITRE)).toHaveCount(1)

  // Autre poste (navigateur vierge) : le groupe gardé sur le serveur suit l'utilisateur
  const autre = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const poste = await autre.newPage()
  await connecter(poste, ADMIN)
  await poste.goto('graphes')
  await expect(menu(poste)).toBeVisible({ timeout: 20_000 })
  await poste.locator('details.menu-groupes summary').click()
  await expect(poste.locator('details.menu-groupes').getByRole('button', { name: new RegExp(NOM) })).toBeVisible({ timeout: 20_000 })
  await autre.close()

  // Le PDF s'ouvre dans le même navigateur : un groupe par page, sans le menu
  await page.goto('rapport?sections=graphes')
  await expect(page.locator('.snap-section').first()).toBeVisible({ timeout: 20_000 })
  expect(await page.locator('.snap-section').count()).toBeGreaterThan(1)
  await expect(page.locator('.graphes-groupe-titre', { hasText: NOM })).toHaveCount(1)
  await expect(page.locator('details.menu-groupes')).toHaveCount(0)

  // Nettoyage : suppression du groupe personnel
  await page.goto('graphes')
  await menu(page).locator('summary').click()
  await menu(page).getByRole('button', { name: 'Personnaliser…' }).click()
  const f2 = page.locator('dialog.perso-groupes')
  await f2.getByRole('button', { name: 'Supprimer' }).click()
  await f2.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(f2).toHaveCount(0)
})

test('groupes de graphiques : un administrateur renomme un groupe d’origine, le nom apparaît dans le menu', async ({ page }) => {
  const DEFAUT = 'Ventes, marge et commissions'
  const NOUVEAU = 'Recette ventes renommées'
  await connecter(page, ADMIN)
  await page.goto('graphes')
  await expect(menu(page)).toBeVisible()

  const ouvrir = async () => {
    await menu(page).locator('summary').click()
    await menu(page).getByRole('button', { name: 'Personnaliser…' }).click()
    const f = page.locator('dialog.perso-groupes')
    await expect(f).toBeVisible()
    return f
  }

  try {
    const f = await ouvrir()
    await f.getByRole('button', { name: `Modifier ${DEFAUT}` }).click()
    await expect(f.getByText(/vu par tous/)).toBeVisible()
    await f.getByLabel('Nom du groupe').fill(NOUVEAU)
    await f.getByRole('button', { name: 'Valider' }).click()
    await f.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(f).toHaveCount(0)

    await page.reload()
    await menu(page).locator('summary').click()
    await expect(menu(page).getByRole('button', { name: new RegExp(NOUVEAU) })).toBeVisible({ timeout: 20_000 })
    await expect(menu(page).getByRole('button', { name: new RegExp(DEFAUT) })).toHaveCount(0)
  } finally {
    // Nettoyage : retour au nom par défaut
    await page.goto('graphes')
    await expect(menu(page)).toBeVisible()
    const f = await ouvrir()
    await f.getByRole('button', { name: `Modifier ${NOUVEAU}` }).click()
    await f.getByLabel('Nom du groupe').fill('')
    await f.getByRole('button', { name: 'Valider' }).click()
    await f.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(f).toHaveCount(0)
  }
})
