import { expect, type Page, test } from '@playwright/test'
import { mdpDe } from './outils'

const BASE_ONGLETS = ['Résumé', 'Graphes', 'Annuel', 'Mensuel', 'Individuel']
const TOUS = ['Administration', 'Commerce Pièces', 'Commerce VN', 'Pneumatique', 'SAV Engins', 'SAV PL', 'Sites Déportés']

type Profil = { email: string; admin?: boolean; nominatif: boolean; services: string[] }
const PROFILS: Profil[] = [
  { email: 'admin@exemple.invalid', admin: true, nominatif: true, services: TOUS },
  { email: 'rh.partenaire@exemple.invalid', admin: true, nominatif: true, services: TOUS },
  { email: 'drh@exemple.invalid', nominatif: true, services: TOUS },
  { email: 'dop@exemple.invalid', nominatif: true, services: TOUS },
  { email: 'dps@exemple.invalid', nominatif: false, services: ['Commerce Pièces', 'SAV Engins', 'SAV PL', 'Sites Déportés'] },
  { email: 'commerce.vn@exemple.invalid', nominatif: false, services: ['Commerce VN'] },
  { email: 'pneumatique@exemple.invalid', nominatif: false, services: ['Pneumatique'] },
  { email: 'sav.pl@exemple.invalid', nominatif: false, services: ['SAV PL'] },
  { email: 'resp.sav.engins@exemple.invalid', nominatif: false, services: ['SAV Engins'] },
  { email: 'sites.deportes@exemple.invalid', nominatif: false, services: ['Sites Déportés'] },
]

async function connecter(page: Page, email: string) {
  await page.goto('login')
  await page.getByRole('group', { name: 'Connexion' }).getByLabel('Adresse e-mail').fill(email)
  await page.getByRole('group', { name: 'Connexion' }).getByLabel('Mot de passe', { exact: true }).fill(mdpDe(email))
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('navigation', { name: 'Rapports' })).toBeVisible()
}

const onglets = (page: Page) => page.getByRole('navigation', { name: 'Rapports' }).getByRole('link')
const optionsService = (page: Page) => page.getByRole('combobox', { name: 'Service' }).locator('option')

for (const p of PROFILS) {
  test(`${p.email} : parcours complet`, async ({ page }) => {
    const erreurs: string[] = []
    page.on('pageerror', (e) => erreurs.push(e.message))
    await connecter(page, p.email)

    const attendus = p.nominatif ? BASE_ONGLETS : BASE_ONGLETS.slice(0, 4)
    await expect(onglets(page)).toHaveText(p.admin ? [...attendus, 'Administration'] : attendus)
    await expect(page.locator('.tuile .micro', { hasText: /^Marge$/ })).toHaveCount(p.nominatif ? 1 : 0)

    for (const rapport of ['Graphes', 'Annuel', 'Mensuel']) {
      await page.getByRole('link', { name: rapport, exact: true }).click()
      await expect(page.getByRole('alert')).toHaveCount(0)
    }
    await expect(optionsService(page)).toHaveText(['Tous', ...p.services])
    await expect(page.getByRole('heading', { name: '1. Reporting global' })).toBeVisible()
    for (const s of p.services) {
      await page.getByRole('combobox', { name: 'Service' }).selectOption({ label: s })
      await expect(page.getByRole('heading', { name: '1. Reporting global' })).toBeVisible()
    }

    await page.goto('individuel')
    if (p.nominatif) {
      await expect(page.getByRole('region', { name: 'Reporting individuel' })).toBeVisible()
      // Filtres partagés entre pages : le service choisi sur Mensuel masquerait EMP015
      await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click()
      await page.getByRole('combobox', { name: 'Employé' }).fill('EMP015')
      await page.locator('li[role=option]').first().click()
      await expect(page.getByText(/Employé retenu : .*EMP015/)).toBeVisible()
    } else {
      // Page non accordée : redirection vers le résumé (pas de 403 affiché)
      await expect(page).toHaveURL(/resume$/)
    }

    await page.goto('admin')
    if (p.admin) {
      await expect(page.getByRole('heading', { name: /ADMINISTRATION DES DONNÉES/ })).toBeVisible()
    } else {
      // Page non accordée : redirection vers le résumé (pas de 403 affiché)
      await expect(page).toHaveURL(/resume$/)
    }

    // Protection côté serveur, indépendamment de l'écran
    for (const url of ['api/v1/users', 'api/v1/imports']) {
      const r = await page.request.get(url)
      expect(r.status(), url).toBe(p.admin ? 200 : 403)
    }

    await page.getByRole('button', { name: 'Profil' }).click()
    await expect(page.locator('#profil-menu').getByText(p.email)).toBeVisible()
    await page.getByRole('button', { name: 'Déconnexion' }).click()
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible()
    expect(erreurs).toEqual([])
  })
}

test('mauvais mot de passe : refusé', async ({ page }) => {
  await page.goto('login')
  await page.getByRole('group', { name: 'Connexion' }).getByLabel('Adresse e-mail').fill('drh@exemple.invalid')
  await page.getByRole('group', { name: 'Connexion' }).getByLabel('Mot de passe', { exact: true }).fill('<mot-de-passe-faux-2>')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Rapports' })).toHaveCount(0)
})
