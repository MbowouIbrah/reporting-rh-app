import { expect, type Page, test } from '@playwright/test'

const PW = '<mot-de-passe-test>'

async function connecter(page: Page, email: string) {
  await page.goto('login')
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(PW)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('navigation', { name: 'Rapports' })).toBeVisible()
}

test('admin : pages Budgets, Paramétrage et Journal accessibles', async ({ page }) => {
  await connecter(page, 'admin@exemple.invalid')
  const nav = page.getByRole('navigation', { name: 'Administration' })
  for (const [lien, titre] of [
    ['Budgets', 'Budgets mensuels'],
    ['Rubriques et règles', 'Paramétrage'],
    ['Journal', 'Journal d’audit'],
  ]) {
    await page.goto('admin/utilisateurs')
    await nav.getByRole('link', { name: 'Réglages' }).click()
    await nav.getByRole('link', { name: lien }).click()
    await expect(page.getByRole('heading', { name: titre, level: 2 })).toBeVisible()
  }
})

test('journal : filtre par entité et diff d’un événement', async ({ page }) => {
  await connecter(page, 'admin@exemple.invalid')
  await page.goto('admin/journal')
  await page.getByLabel('Entité').selectOption('utilisateur')
  await expect(page).toHaveURL(/entite=utilisateur/)
  const lignes = page.locator('tbody tr')
  await expect(lignes.first()).toContainText('utilisateur')
  await page.getByRole('button', { name: 'Historique' }).first().click()
  await expect(page).toHaveURL(/entite_id=/)
})

test('lecteur de périmètre : pas de Journal ni d’administration', async ({ page }) => {
  await connecter(page, 'dps.equipment@exemple.invalid')
  await page.goto('admin/journal')
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
