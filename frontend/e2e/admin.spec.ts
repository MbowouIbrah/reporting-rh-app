import { expect, type Page, test } from '@playwright/test'

const PW = '<mot-de-passe-test>'

async function connecter(page: Page, email: string) {
  await page.goto('login')
  await page.getByRole('group', { name: 'Connexion' }).getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(PW)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('navigation', { name: 'Rapports' })).toBeVisible()
}

test('admin : feuille DONNEES filtrable puis réinitialisée', async ({ page }) => {
  await connecter(page, 'admin@exemple.invalid')
  await page.getByRole('link', { name: 'Administration' }).click()
  await expect(page).toHaveURL(/admin$/)
  await expect(page.getByRole('heading', { name: /ADMINISTRATION DES DONNÉES/, level: 2 })).toBeVisible()
  // Filtres de la feuille : aucun n'est posé à l'ouverture, Réinitialiser est donc grisé
  const filtres = page.getByRole('group', { name: 'Filtres' })
  await expect(filtres).toBeVisible()
  await expect(filtres.getByLabel('Année')).toHaveValue('')
  await expect(filtres.getByRole('button', { name: 'Réinitialiser les filtres' })).toBeDisabled()
  await expect(page.getByRole('columnheader')).toHaveCount(28)
  // Fin de feuille : le total des rubriques comptées, puis celui des colonnes exclues du total
  await expect(page.getByRole('columnheader').nth(26)).toHaveText('TOTAL CHARGES (FCFA)')
  await expect(page.getByRole('columnheader').last()).toHaveText('Total des colonnes exclues')
  const lignes = page.locator('tbody tr:not(.reste)')
  await expect(lignes).toHaveCount(6)
  await page.getByLabel('Mois').selectOption('Février')
  await expect(page).toHaveURL(/mois=2/)
  await expect(lignes).toHaveCount(3)
  const e2 = lignes.filter({ hasText: 'E2' })
  await expect(e2.locator('td').nth(26)).toHaveText(/^2\s?100$/)
  await expect(e2.locator('td').nth(27)).toHaveText('999')
  const employe = page.getByRole('combobox', { name: 'Employé' })
  await employe.fill('Ann')
  await employe.press('Enter')
  await expect(page).toHaveURL(/matricule=/)
  await expect(lignes).toHaveCount(1)
  await page.getByRole('button', { name: 'Réinitialiser' }).click()
  await expect(lignes).toHaveCount(6)
  await expect(page.getByLabel('Mois')).toHaveValue('')
})

test('session conservée après expiration du jeton d’accès', async ({ page }) => {
  await connecter(page, 'admin@exemple.invalid')
  await page.context().clearCookies({ name: 'access_token' })
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Rapports' })).toBeVisible()
  await expect(page).not.toHaveURL(/login/)
})

test('anciens liens d’administration : renvoi vers la feuille DONNEES', async ({ page }) => {
  await connecter(page, 'admin@exemple.invalid')
  await page.goto('admin/cloture')
  await expect(page).toHaveURL(/admin$/)
  await expect(page.getByRole('heading', { name: /ADMINISTRATION DES DONNÉES/ })).toBeVisible()
})

test('lecteur de périmètre : pas d’administration', async ({ page }) => {
  await connecter(page, 'dps.equipment@exemple.invalid')
  await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0)
  await page.goto('admin')
  // Page non accordée : renvoi vers le résumé, sans page d'erreur
  await expect(page).toHaveURL(/resume$/)
  await expect(page.getByRole('heading', { name: /ADMINISTRATION/ })).toHaveCount(0)
})

// L'export xlsx des rapports a été retiré de l'écran au profit de l'export PDF : même règle vérifiée,
// le rapport s'ouvre avec les filtres de l'écran (période choisie).
test('export PDF mensuel : le rapport s’ouvre avec les filtres de l’écran', async ({ page }) => {
  await connecter(page, 'admin@exemple.invalid')
  await page.getByRole('link', { name: 'Mensuel' }).click()
  await page.getByRole('combobox', { name: 'Période' }).click()
  await page.getByRole('option').filter({ hasText: 'Janvier' }).filter({ hasText: '2026' }).click()
  await page.getByRole('button', { name: 'Exporter en PDF' }).click()
  const [rapport] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Exporter', exact: true }).click()])
  await expect(rapport).toHaveURL(/\/rapport\?(?=.*annee=2026)(?=.*mois=1(&|$))(?=.*sections=mensuel(&|$))/)
  await expect(rapport.locator('.snap-section').first()).toBeVisible()
  await expect(rapport.getByRole('navigation', { name: 'Rapports' })).toHaveCount(0)
})
