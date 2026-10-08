import { expect, type Page, test } from '@playwright/test'

const PW = '<mot-de-passe-test>'

async function connecter(page: Page, email: string) {
  await page.goto('login')
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(PW)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('navigation', { name: 'Rapports' })).toBeVisible()
}

const onglets = (page: Page) => page.getByRole('navigation', { name: 'Rapports' }).getByRole('link')

const BASE_ONGLETS = ['Résumé', 'Mensuel', 'Annuel', 'Graphes', 'Individuel']
for (const email of ['admin@exemple.invalid', 'drh@exemple.invalid']) {
  test(`${email} : onglets, marge visible, contrôles OK`, async ({ page }) => {
    await connecter(page, email)
    await expect(onglets(page)).toHaveText(
      email.startsWith('admin') ? [...BASE_ONGLETS, 'Administration'] : BASE_ONGLETS,
    )
    await expect(page.locator('.tuile .micro', { hasText: /^MARGE$/ }).first()).toBeVisible()
    await page.getByRole('link', { name: 'Mensuel' }).click()
    await expect(page.getByText('Contrôles de cohérence : OK')).toBeVisible()
    await expect(page.getByText('5. Nature de contrat')).toBeVisible()
  })
}

test('lecteur de périmètre : ni Individuel, ni marge, services limités', async ({ page }) => {
  await connecter(page, 'dps.equipment@exemple.invalid')
  await expect(onglets(page)).toHaveText(['Résumé', 'Mensuel', 'Annuel', 'Graphes'])
  await expect(page.locator('.tuile .micro', { hasText: /^MARGE$/ })).toHaveCount(0)
  await page.getByRole('link', { name: 'Mensuel' }).click()
  const services = page.getByLabel('Service').locator('option')
  await expect(services).toHaveText(['Tous', 'SAV PL'])
  await page.goto('individuel')
  await expect(page.getByRole('alert')).toContainText('Accès refusé')
})

test('directeur commercial VN : seul son service', async ({ page }) => {
  await connecter(page, 'dir.commercial.vn@exemple.invalid')
  await page.getByRole('link', { name: 'Annuel' }).click()
  await expect(page.getByLabel('Service').locator('option')).toHaveText(['Tous', 'Commerce VN'])
})

test('filtres indépendants entre pages', async ({ page }) => {
  await connecter(page, 'admin@exemple.invalid')
  await page.getByRole('link', { name: 'Mensuel' }).click()
  await page.getByLabel('Mois').selectOption('1')
  await expect(page).toHaveURL(/mois=1/)
  await page.getByRole('link', { name: 'Annuel' }).click()
  await expect(page).toHaveURL(/annuel$/)
  await expect(page.getByRole('link', { name: /Exporter/ })).toHaveAttribute('href', /mois=2/)
})

test('access token supprimé : rattrapé par le refresh', async ({ page, context }) => {
  await connecter(page, 'admin@exemple.invalid')
  await context.clearCookies({ name: 'access_token' })
  await page.getByRole('link', { name: 'Mensuel' }).click()
  await expect(page.getByText('Contrôles de cohérence : OK')).toBeVisible()
})

test('fiche individuelle puis déconnexion', async ({ page }) => {
  await connecter(page, 'drh@exemple.invalid')
  await page.getByRole('link', { name: 'Individuel' }).click()
  await expect(page.getByRole('region', { name: 'Reporting individuel' })).toBeVisible()
  await page.getByLabel('Matricule').selectOption('E1')
  await expect(page.getByText('Employé retenu : Ann')).toBeVisible()
  await page.getByRole('button', { name: 'Déconnexion' }).click()
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible()
})
