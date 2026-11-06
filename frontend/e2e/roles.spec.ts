import { expect, type Page, test } from '@playwright/test'
import { PW, courriel } from './identites'

async function connecter(page: Page, email: string) {
  await page.goto('login')
  await page.getByRole('group', { name: 'Connexion' }).getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(PW)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('navigation', { name: 'Rapports' })).toBeVisible()
}

const onglets = (page: Page) => page.getByRole('navigation', { name: 'Rapports' }).getByRole('link')

const BASE_ONGLETS = ['Résumé', 'Graphes', 'Annuel', 'Mensuel', 'Individuel']
for (const email of [courriel('admin'), courriel('drh')]) {
  test(`${email} : onglets, marge visible, contrôles OK`, async ({ page }) => {
    await connecter(page, email)
    await expect(onglets(page)).toHaveText(
      email.startsWith('admin') ? [...BASE_ONGLETS, 'Administration'] : BASE_ONGLETS,
    )
    await expect(page.locator('.tuile .micro', { hasText: /^Marge$/ }).first()).toBeVisible()
    await page.getByRole('link', { name: 'Mensuel' }).click()
    await expect(page.getByRole('heading', { name: '1. Reporting global' })).toBeVisible()
    await expect(page.getByText('4. Répartition par nature de contrat')).toBeVisible()
  })
}

test('lecteur de périmètre : ni Individuel, ni marge, services limités', async ({ page }) => {
  await connecter(page, courriel('dps.equipment'))
  await expect(onglets(page)).toHaveText(['Résumé', 'Graphes', 'Annuel', 'Mensuel'])
  await expect(page.locator('.tuile .micro', { hasText: /^Marge$/ })).toHaveCount(0)
  await page.getByRole('link', { name: 'Mensuel' }).click()
  const services = page.getByLabel('Service').locator('option')
  await expect(services).toHaveText(['Tous', 'SAV PL'])
  await page.goto('individuel')
  // Page non accordée : renvoi vers le résumé, sans page d'erreur
  await expect(page).toHaveURL(/resume$/)
  await expect(page.getByRole('heading', { name: /INDIVIDUEL/i })).toHaveCount(0)
})

test('directeur commercial VN : seul son service', async ({ page }) => {
  await connecter(page, courriel('dir.commercial.vn'))
  await page.getByRole('link', { name: 'Annuel' }).click()
  await expect(page.getByLabel('Service').locator('option')).toHaveText(['Tous', 'Commerce VN'])
})

// Règle actuelle : les filtres sont communs à toutes les pages (la période choisie sur le mensuel
// se retrouve ailleurs), et non plus propres à chaque page comme à l'origine.
test('filtres partagés entre pages', async ({ page }) => {
  await connecter(page, courriel('admin'))
  await page.getByRole('link', { name: 'Mensuel' }).click()
  await page.getByRole('combobox', { name: 'Période' }).click()
  await page.getByRole('option').filter({ hasText: 'Janvier' }).filter({ hasText: '2026' }).click()
  await expect(page).toHaveURL(/mois=1/)
  const service = () => page.getByRole('combobox', { name: 'Service' })
  const libelle = (await service().locator('option').nth(1).textContent())!
  await service().selectOption(libelle)
  await page.getByRole('link', { name: 'Annuel' }).click()
  await expect(page).toHaveURL(/annuel/)
  await expect(service()).toHaveValue(libelle)
  await page.getByRole('link', { name: 'Mensuel' }).click()
  await expect(service()).toHaveValue(libelle)
  await expect(page.getByRole('combobox', { name: 'Période' })).toContainText(/Janvier\s*2026/)
})

test('access token supprimé : rattrapé par le refresh', async ({ page, context }) => {
  await connecter(page, courriel('admin'))
  await context.clearCookies({ name: 'access_token' })
  await page.getByRole('link', { name: 'Mensuel' }).click()
  await expect(page.getByRole('heading', { name: '1. Reporting global' })).toBeVisible()
})

test('fiche individuelle puis déconnexion', async ({ page }) => {
  await connecter(page, courriel('drh'))
  await page.getByRole('link', { name: 'Individuel' }).click()
  await expect(page.getByRole('region', { name: 'Reporting individuel' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Employé' }).fill('E1')
  await page.getByRole('listbox', { name: 'Employés' }).getByRole('option').first().click()
  await expect(page.getByText('Employé retenu : Ann')).toBeVisible()
  await page.getByRole('button', { name: 'Profil' }).click()
  await expect(page.locator('#profil-menu').getByText(courriel('drh'))).toBeVisible()
  await page.getByRole('button', { name: 'Déconnexion' }).click()
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible()
})
