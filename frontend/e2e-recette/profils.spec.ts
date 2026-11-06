import { randomBytes } from 'node:crypto'
import { expect, type Page, test } from '@playwright/test'
import { compte } from './outils'

const BASE_ONGLETS = ['Résumé', 'Graphes', 'Annuel', 'Mensuel', 'Individuel']
const TOUS = ['Administration', 'Commerce Pièces', 'Commerce VN', 'Pneumatique', 'SAV Engins', 'SAV PL', 'Sites Déportés']

type Profil = { identifiant: string; admin?: boolean; nominatif: boolean; services: string[] }
const PROFILS: Profil[] = [
  { identifiant: 'admin', admin: true, nominatif: true, services: TOUS },
  { identifiant: 'rh.partenaire', admin: true, nominatif: true, services: TOUS },
  { identifiant: 'drh', nominatif: true, services: TOUS },
  { identifiant: 'dop', nominatif: true, services: TOUS },
  { identifiant: 'dps', nominatif: false, services: ['Commerce Pièces', 'SAV Engins', 'SAV PL', 'Sites Déportés'] },
  { identifiant: 'commerce.vn', nominatif: false, services: ['Commerce VN'] },
  { identifiant: 'pneumatique', nominatif: false, services: ['Pneumatique'] },
  { identifiant: 'sav.pl', nominatif: false, services: ['SAV PL'] },
  { identifiant: 'resp.sav.engins', nominatif: false, services: ['SAV Engins'] },
  { identifiant: 'sites.deportes', nominatif: false, services: ['Sites Déportés'] },
]

async function connecter(page: Page, identifiant: string) {
  const { email, mdp } = compte(identifiant)
  await page.goto('login')
  await page.getByRole('group', { name: 'Connexion' }).getByLabel('Adresse e-mail').fill(email)
  await page.getByRole('group', { name: 'Connexion' }).getByLabel('Mot de passe', { exact: true }).fill(mdp)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('navigation', { name: 'Rapports' })).toBeVisible()
}

const onglets = (page: Page) => page.getByRole('navigation', { name: 'Rapports' }).getByRole('link')
const optionsService = (page: Page) => page.getByRole('combobox', { name: 'Service' }).locator('option')

for (const p of PROFILS) {
  test(`${p.identifiant} : parcours complet`, async ({ page }) => {
    const erreurs: string[] = []
    page.on('pageerror', (e) => erreurs.push(e.message))
    await connecter(page, p.identifiant)

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
    await expect(page.locator('#profil-menu').getByText(compte(p.identifiant).email)).toBeVisible()
    await page.getByRole('button', { name: 'Déconnexion' }).click()
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible()
    expect(erreurs).toEqual([])
  })
}

test('mauvais mot de passe : refusé', async ({ page }) => {
  await page.goto('login')
  await page.getByRole('group', { name: 'Connexion' }).getByLabel('Adresse e-mail').fill(compte('drh').email)
  await page.getByRole('group', { name: 'Connexion' }).getByLabel('Mot de passe', { exact: true }).fill('t-' + randomBytes(12).toString('hex'))
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Rapports' })).toHaveCount(0)
})
