import { expect, type Page, test } from '@playwright/test'

const PW = '<mot-de-passe-test>'

async function connecter(page: Page, email: string) {
  await page.goto('login')
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(PW)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('navigation', { name: 'Rapports' })).toBeVisible()
}

test('admin : feuille DONNEES filtrable puis réinitialisée', async ({ page }) => {
  await connecter(page, 'admin@exemple.invalid')
  await page.getByRole('link', { name: 'Administration' }).click()
  await expect(page).toHaveURL(/admin$/)
  await expect(page.getByRole('heading', { name: /ADMINISTRATION DES DONNÉES/, level: 2 })).toBeVisible()
  await expect(page.getByText(/^Saisir ANNÉE \(ex\. 2025\)/)).toBeVisible()
  await expect(page.getByRole('columnheader')).toHaveCount(28)
  await expect(page.getByRole('columnheader').last()).toHaveText('TOTAL CHARGES (FCFA)')
  const lignes = page.locator('tbody tr:not(.reste)')
  await expect(lignes).toHaveCount(6)
  await page.getByLabel('Mois').selectOption('Février')
  await expect(page).toHaveURL(/mois=2/)
  await expect(lignes).toHaveCount(3)
  const e2 = lignes.filter({ hasText: 'E2' })
  await expect(e2.locator('td').nth(26)).toHaveText('999')
  await expect(e2.locator('td').nth(27)).toHaveText(/^2\s?100$/)
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
  await expect(page.getByRole('alert')).toContainText('Accès refusé')
})

test('export xlsx mensuel : téléchargement avec les filtres de l’écran', async ({ page }) => {
  await connecter(page, 'admin@exemple.invalid')
  await page.getByRole('link', { name: 'Mensuel' }).click()
  const lien = page.getByRole('link', { name: 'Exporter (xlsx)' })
  await expect(lien).toBeVisible()
  const [dl] = await Promise.all([page.waitForEvent('download'), lien.click()])
  expect(dl.suggestedFilename()).toMatch(/^reporting-mensuel-\d{4}-\d{2}\.xlsx$/)
})
