import { expect, type Page, test } from '@playwright/test'
import { ADMIN, connecter, deconnecter, lireJson } from './outils'

type Appel = { methode: 'POST' | 'PUT' | 'DELETE'; url: string; data?: object }

// Écritures réservées à l'administrateur, avec un contenu valide : seul le droit doit les refuser
const ECRITURES: Appel[] = [
  { methode: 'POST', url: 'users', data: { email: 'intrus@exemple.invalid', nom: 'Intrus', password: '<mot-de-passe-test-2>', roles: [{ role: 'rh_admin' }] } },
  { methode: 'PUT', url: 'users/1', data: { email: 'admin@exemple.invalid', nom: 'Piraté', roles: [{ role: 'lecteur_global' }] } },
  { methode: 'DELETE', url: 'users/2' },
  { methode: 'POST', url: 'perimetres', data: { code: 'INTRUS', libelle: 'Intrus', regles: [] } },
  { methode: 'PUT', url: 'perimetres/1', data: { code: 'INTRUS', libelle: 'Intrus', regles: [] } },
  { methode: 'DELETE', url: 'perimetres/1' },
  { methode: 'POST', url: 'salaries', data: { matricule: 'INTRUS1', nom: 'Intrus' } },
  { methode: 'PUT', url: 'salaries/1', data: { matricule: 'EMP001', nom: 'Piraté' } },
  { methode: 'PUT', url: 'pilotage/ca-marge', data: { annee: 2026, mois: 6, ca: '1', marge: '1' } },
  { methode: 'PUT', url: 'pilotage/budgets', data: { annee: 2026, mois: 6, lignes: [] } },
  { methode: 'POST', url: 'donnees/lignes', data: { annee: 2026, mois: 6, matricule: 'EMP001', montants: {} } },
  { methode: 'POST', url: 'donnees/verifier', data: { annee: 2026, mois: 6, lignes: [] } },
  { methode: 'POST', url: 'donnees/lots', data: { brouillon_id: 'brouillon-intrus', annee: 2026, mois: 6, lignes: [] } },
  { methode: 'POST', url: 'imports/1/valider' },
  { methode: 'POST', url: 'imports/1/annuler' },
  { methode: 'POST', url: 'referentiels/service', data: { libelle: 'Service intrus' } },
  { methode: 'PUT', url: 'referentiels/service/1', data: { libelle: 'Piraté' } },
  { methode: 'PUT', url: 'parametrage/colonnes', data: { colonnes: [] } },
  { methode: 'POST', url: 'parametrage/rubriques', data: { libelle: 'Rubrique intrus', unite: 'FCFA' } },
]
const LECTURES_ADMIN = ['users', 'audit', 'imports', 'donnees/tableau', 'donnees/preparation?annee=2026&mois=6', 'parametrage']

// Entrées du journal hors connexions : les refus n'en ajoutent aucune
async function ecritures(admin: Page) {
  const audit = await lireJson<{ action: string }[]>(admin.request, 'audit?limit=2000')
  return audit.filter((x) => x.action !== 'login' && x.action !== 'login_echec').length
}

async function essayer(page: Page, a: Appel) {
  const options = a.data ? { data: a.data } : undefined
  const url = `api/v1/${a.url}`
  return a.methode === 'POST' ? page.request.post(url, options) : a.methode === 'PUT' ? page.request.put(url, options) : page.request.delete(url)
}

for (const profil of [{ email: 'drh@exemple.invalid', nom: 'DRH (lecteur global)' }, { email: 'dps@exemple.invalid', nom: 'DPS (lecteur de périmètre)' }]) {
  test.describe.serial(`lecteur sans droit d’écriture : ${profil.nom}`, () => {
    let avant = { utilisateurs: 0, perimetres: 0, salaries: 0, audit: 0 }

    test('aucune écriture ni lecture d’administration n’est acceptée par l’API', async ({ page, browser, baseURL }) => {
      // État de référence, relevé par l'administrateur dans un autre contexte
      const ctx = await browser.newContext({ baseURL })
      const admin = await ctx.newPage()
      await connecter(admin, ADMIN)
      avant = {
        utilisateurs: (await lireJson<unknown[]>(admin.request, 'users')).length,
        perimetres: (await lireJson<unknown[]>(admin.request, 'perimetres')).length,
        salaries: (await lireJson<unknown[]>(admin.request, 'salaries')).length,
        audit: await ecritures(admin),
      }

      await connecter(page, profil.email)
      for (const a of ECRITURES) expect((await essayer(page, a)).status(), `${a.methode} ${a.url}`).toBe(403)
      for (const url of LECTURES_ADMIN) expect((await page.request.get(`api/v1/${url}`)).status(), `GET ${url}`).toBe(403)

      // Rien n'a bougé, et les refus ne laissent aucune trace d'écriture
      expect((await lireJson<unknown[]>(admin.request, 'users')).length).toBe(avant.utilisateurs)
      expect((await lireJson<unknown[]>(admin.request, 'perimetres')).length).toBe(avant.perimetres)
      expect((await lireJson<unknown[]>(admin.request, 'salaries')).length).toBe(avant.salaries)
      expect(await ecritures(admin)).toBe(avant.audit)
      expect((await lireJson<{ matricule: string; nom: string }[]>(admin.request, 'salaries')).find((s) => s.matricule === 'EMP001')!.nom).not.toBe('Piraté')
      await ctx.close()
    })

    test('à l’écran : pas d’onglet Administration, pages d’administration refusées', async ({ page }) => {
      await connecter(page, profil.email)
      await expect(page.getByRole('navigation', { name: 'Rapports' }).getByRole('link', { name: 'Administration' })).toHaveCount(0)
      for (const chemin of ['admin', 'admin/saisie', 'admin/employes', 'admin/referentiels']) {
        await page.goto(chemin)
        await expect(page.getByRole('alert')).toContainText('Accès refusé')
        await expect(page.getByRole('button', { name: /Enregistrer|Nouvel employé|Importer/ })).toHaveCount(0)
      }
      await deconnecter(page)
    })
  })
}
