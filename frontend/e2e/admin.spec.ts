import { expect, type Page, test } from '@playwright/test'

const PW = '<mot-de-passe-test>'

async function connecter(page: Page, email: string) {
  await page.goto('login')
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(PW)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('navigation', { name: 'Rapports' })).toBeVisible()
}

test('admin : navigation limitée aux trois onglets', async ({ page }) => {
  await connecter(page, 'admin@exemple.invalid')
  await page.goto('admin/cloture')
  const nav = page.getByRole('navigation', { name: 'Administration' })
  for (const [lien, titre] of [
    ['Employés', 'Employés'],
    ['Accès', 'Accès : qui voit quoi'],
  ]) {
    await nav.getByRole('link', { name: lien }).click()
    await expect(page.getByRole('heading', { name: titre, level: 2 })).toBeVisible()
  }
  await expect(nav.getByRole('link')).toHaveCount(3)
})

test('fin de mois : ouvrir un mois puis saisir le CA', async ({ page }) => {
  await connecter(page, 'admin@exemple.invalid')
  await page.goto('admin/cloture?periode=2033-07&etape=ca')
  await expect(page.getByRole('heading', { name: 'Fin de mois', level: 2 })).toBeVisible()
  await page.getByRole('button', { name: /^Ouvrir juillet 2033/i }).click()
  const champ = page.getByLabel('Chiffre d’affaires', { exact: true })
  await expect(champ).toBeVisible()
  await champ.fill('1234567.5')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await page.reload()
  await expect(page.getByLabel('Chiffre d’affaires', { exact: true })).toHaveValue(/1234567/)
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
