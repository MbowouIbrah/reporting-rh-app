import { expect, type APIRequestContext, type Browser, type Page, test } from '@playwright/test'
import { ADMIN, connecter, lireJson } from './outils'

// Gestion des utilisateurs : pas d'écran, tout passe par l'API d'administration ; on contrôle ensuite ce que
// voit chaque nouveau compte dans l'application.
const MDP = '<mot-de-passe-test-2>'
const BASE_ONGLETS = ['Résumé', 'Graphes', 'Annuel', 'Mensuel', 'Individuel']
const TOUS = ['Administration', 'Commerce Pièces', 'Commerce VN', 'Pneumatique', 'SAV Engins', 'SAV PL', 'Sites Déportés']

const EMAIL = {
  admin: 'admin.recette@exemple.invalid',
  global: 'lecteur.global@exemple.invalid',
  anonyme: 'lecteur.anonyme@exemple.invalid',
  perimetre: 'lecteur.perimetre@exemple.invalid',
  perimetreNominatif: 'lecteur.perimetre.nominatif@exemple.invalid',
}

type Role = { role: string; perimetre_id?: number | null; nominatif?: boolean }
type User = { id: number; email: string; nom: string; actif: boolean; roles: Required<Role>[] }
type Audit = { id: number; action: string; entite: string; entite_id: string; utilisateur_id: number | null; avant: any; apres: any }
type Perimetre = { id: number; code: string; libelle: string; regles: { dimension: string; valeur: string }[] }

const utilisateurs = (r: APIRequestContext) => lireJson<User[]>(r, 'users')
const utilisateur = async (r: APIRequestContext, email: string) => (await utilisateurs(r)).find((u) => u.email === email)
const creer = (r: APIRequestContext, email: string, nom: string, roles: Role[], password = MDP) =>
  r.post('api/v1/users', { data: { email, nom, password, roles } })
const modifier = (r: APIRequestContext, id: number, data: object) => r.put(`api/v1/users/${id}`, { data })
const journal = (r: APIRequestContext, query: string) => lireJson<Audit[]>(r, `audit?${query}`)

const onglets = (page: Page) => page.getByRole('navigation', { name: 'Rapports' }).getByRole('link')
const optionsService = (page: Page) => page.getByRole('combobox', { name: 'Service' }).locator('option')

/** Session d'un autre compte, indépendante de celle de l'administrateur de la recette. */
async function session(browser: Browser, baseURL: string | undefined, email: string, mdp = MDP) {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await connecter(page, email, mdp)
  return { context, page }
}

async function voir(page: Page, attendus: { onglets: string[]; services: string[]; marge: boolean }) {
  await expect(onglets(page)).toHaveText(attendus.onglets)
  await expect(page.locator('.tuile .micro', { hasText: /^MARGE$/ })).toHaveCount(attendus.marge ? 1 : 0)
  await page.getByRole('link', { name: 'Mensuel', exact: true }).click()
  await expect(optionsService(page)).toHaveText(['Tous', ...attendus.services])
}

let perimetrePneu: Perimetre
let perimetreSites: Perimetre

test.describe.serial('gestion des utilisateurs', () => {
  test.beforeEach(async ({ page }) => {
    await connecter(page, ADMIN)
  })

  test('administrateur créé : connexion (e-mail en majuscules accepté), écran d’administration et API admin', async ({ page, browser, baseURL }) => {
    const rep = await creer(page.request, 'Admin.Recette@exemple.invalid', 'Admin Recette', [{ role: 'rh_admin' }])
    expect(rep.status()).toBe(201)
    const cree = (await rep.json()) as User
    expect(cree).toMatchObject({ email: EMAIL.admin, nom: 'Admin Recette', actif: true })
    expect(cree.roles).toEqual([{ role: 'rh_admin', perimetre_id: null, nominatif: false }])

    const { context, page: p } = await session(browser, baseURL, 'Admin.Recette@exemple.invalid')
    await voir(p, { onglets: [...BASE_ONGLETS, 'Administration'], services: TOUS, marge: true })
    await p.goto('admin')
    await expect(p.getByRole('heading', { name: /ADMINISTRATION DES DONNÉES/ })).toBeVisible()
    expect((await p.request.get('api/v1/users')).status()).toBe(200)
    expect((await p.request.get('api/v1/audit')).status()).toBe(200)
    await context.close()
  })

  test('lecteur global : voit tout, nominatif et marge compris, quel que soit le drapeau nominatif', async ({ page, browser, baseURL }) => {
    expect((await creer(page.request, EMAIL.global, 'Lecteur Global', [{ role: 'lecteur_global', nominatif: true }])).status()).toBe(201)
    expect((await creer(page.request, EMAIL.anonyme, 'Lecteur Anonyme', [{ role: 'lecteur_global', nominatif: false }])).status()).toBe(201)

    const nominatif = await session(browser, baseURL, EMAIL.global)
    await voir(nominatif.page, { onglets: BASE_ONGLETS, services: TOUS, marge: true })
    await nominatif.page.goto('individuel')
    await expect(nominatif.page.getByRole('region', { name: 'Reporting individuel' })).toBeVisible()
    await nominatif.page.goto('admin')
    await expect(nominatif.page.getByRole('alert')).toContainText('Accès refusé')
    expect((await nominatif.page.request.get('api/v1/users')).status()).toBe(403)
    await nominatif.context.close()

    // Pour un lecteur global, le drapeau « nominatif » est sans effet : l'accès nominatif et la marge sont inclus dans le rôle
    const anonyme = await session(browser, baseURL, EMAIL.anonyme)
    await voir(anonyme.page, { onglets: BASE_ONGLETS, services: TOUS, marge: true })
    expect((await anonyme.page.request.get('api/v1/rapports/salaries?annee=2026')).status()).toBe(200)
    expect((await anonyme.page.request.get('api/v1/users')).status()).toBe(403)
    await anonyme.context.close()
  })

  test('lecteur de périmètre : ne voit que son service, ses périmètres seulement', async ({ page, browser, baseURL }) => {
    const nouveau = (code: string, libelle: string, valeur: string) =>
      page.request.post('api/v1/perimetres', { data: { code, libelle, regles: [{ dimension: 'service', valeur }] } })
    const a = await nouveau('RECETTE_PNEU', 'Recette Pneumatique', 'Pneumatique')
    const b = await nouveau('RECETTE_SITES', 'Recette Sites déportés', 'Sites Déportés')
    expect(a.status()).toBe(201)
    expect(b.status()).toBe(201)
    perimetrePneu = (await a.json()) as Perimetre
    perimetreSites = (await b.json()) as Perimetre
    expect(perimetrePneu.regles).toEqual([{ dimension: 'service', valeur: 'Pneumatique' }])

    const rep = await creer(page.request, EMAIL.perimetre, 'Lecteur Périmètre', [{ role: 'lecteur_perimetre', perimetre_id: perimetrePneu.id }])
    expect(rep.status()).toBe(201)
    expect(((await rep.json()) as User).roles).toEqual([{ role: 'lecteur_perimetre', perimetre_id: perimetrePneu.id, nominatif: false }])

    const { context, page: p } = await session(browser, baseURL, EMAIL.perimetre)
    await voir(p, { onglets: BASE_ONGLETS.slice(0, 4), services: ['Pneumatique'], marge: false })
    await expect(p.getByText('Contrôles de cohérence : OK')).toBeVisible()
    await p.goto('individuel')
    await expect(p.getByRole('alert')).toContainText('Accès refusé')
    expect((await p.request.get('api/v1/rapports/salaries?annee=2026')).status()).toBe(403)
    // Les périmètres lisibles se limitent au sien
    const vus = await lireJson<Perimetre[]>(p.request, 'perimetres')
    expect(vus.map((x) => x.code)).toEqual(['RECETTE_PNEU'])
    expect((await p.request.get(`api/v1/perimetres/${perimetreSites.id}`)).status()).toBe(403)
    expect((await p.request.post('api/v1/perimetres', { data: { code: 'X', libelle: 'X' } })).status()).toBe(403)
    await context.close()

    // Même périmètre avec l'accès nominatif : l'individuel s'ouvre, jamais la marge
    expect((await creer(page.request, EMAIL.perimetreNominatif, 'Périmètre nominatif', [{ role: 'lecteur_perimetre', perimetre_id: perimetrePneu.id, nominatif: true }])).status()).toBe(201)
    const n = await session(browser, baseURL, EMAIL.perimetreNominatif)
    await voir(n.page, { onglets: BASE_ONGLETS, services: ['Pneumatique'], marge: false })
    await n.context.close()
  })

  test('rôles incohérents refusés : périmètre manquant ou superflu, rôle inconnu', async ({ page }) => {
    const avant = (await utilisateurs(page.request)).length
    const essai = async (email: string, roles: Role[]) => (await creer(page.request, email, 'Essai', roles)).status()
    expect(await essai('sans.perimetre@exemple.invalid', [{ role: 'lecteur_perimetre' }])).toBe(422)
    expect(await essai('perimetre.superflu@exemple.invalid', [{ role: 'rh_admin', perimetre_id: perimetrePneu.id }])).toBe(422)
    expect(await essai('role.inconnu@exemple.invalid', [{ role: 'super_admin' }])).toBe(422)
    // Périmètre inexistant : non testé ici, la base de recette (SQLite) n'applique pas les clés étrangères, le refus 409 relève de PostgreSQL
    expect((await utilisateurs(page.request)).length).toBe(avant)
  })

  test('changement de périmètre puis de rôle : visible à la reconnexion', async ({ page, browser, baseURL }) => {
    const u = (await utilisateur(page.request, EMAIL.perimetre))!

    const rep1 = await modifier(page.request, u.id, { roles: [{ role: 'lecteur_perimetre', perimetre_id: perimetreSites.id }] })
    expect(rep1.status()).toBe(200)
    let s = await session(browser, baseURL, EMAIL.perimetre)
    await voir(s.page, { onglets: BASE_ONGLETS.slice(0, 4), services: ['Sites Déportés'], marge: false })
    await s.context.close()

    const rep2 = await modifier(page.request, u.id, { roles: [{ role: 'lecteur_global', nominatif: true }] })
    expect(rep2.status()).toBe(200)
    s = await session(browser, baseURL, EMAIL.perimetre)
    await voir(s.page, { onglets: BASE_ONGLETS, services: TOUS, marge: true })
    await s.context.close()

    // Journal : avant / après du changement de rôle, sans mot de passe
    const lignes = await journal(page.request, `entite=utilisateur&entite_id=${u.id}`)
    const maj = lignes.filter((l) => l.action === 'update')
    expect(maj.length).toBeGreaterThanOrEqual(2)
    expect(maj[0].avant.roles[0].role).toBe('lecteur_perimetre')
    expect(maj[0].apres.roles[0]).toMatchObject({ role: 'lecteur_global', nominatif: true })
    expect(JSON.stringify(lignes)).not.toMatch(/password|hash/i)
  })

  test('désactivation : connexion refusée, session ouverte coupée, réactivation rétablit l’accès', async ({ page, browser, baseURL }) => {
    const u = (await utilisateur(page.request, EMAIL.global))!
    const ouverte = await session(browser, baseURL, EMAIL.global)
    expect((await ouverte.page.request.get('api/v1/auth/me')).status()).toBe(200)

    const rep = await modifier(page.request, u.id, { actif: false })
    expect(rep.status()).toBe(200)
    expect((await rep.json()).actif).toBe(false)

    // Connexion refusée par l'écran
    const refus = await browser.newContext({ baseURL })
    const p = await refus.newPage()
    await p.goto('login')
    await p.getByLabel('Adresse e-mail').fill(EMAIL.global)
    await p.getByLabel('Mot de passe').fill(MDP)
    await p.getByRole('button', { name: 'Se connecter' }).click()
    await expect(p.getByRole('alert')).toBeVisible()
    await expect(p.getByRole('navigation', { name: 'Rapports' })).toHaveCount(0)
    await refus.close()

    // Session déjà ouverte : le compte ne passe plus
    expect((await ouverte.page.request.get('api/v1/auth/me')).status()).toBe(401)
    expect((await ouverte.page.request.get('api/v1/rapports/periodes')).status()).toBe(401)
    await ouverte.context.close()

    // Échec tracé dans le journal
    const echecs = (await journal(page.request, `entite=utilisateur&entite_id=${u.id}`)).filter((l) => l.action === 'login_echec')
    expect(echecs.length).toBeGreaterThan(0)

    const rep2 = await modifier(page.request, u.id, { actif: true })
    expect(rep2.status()).toBe(200)
    const s = await session(browser, baseURL, EMAIL.global)
    await expect(onglets(s.page).first()).toBeVisible()
    await s.context.close()
  })

  test('mot de passe : trop court refusé à la création et au changement, nouveau mot de passe pris en compte', async ({ page, browser, baseURL }) => {
    const faible = await creer(page.request, 'mdp.faible@exemple.invalid', 'Mot de passe faible', [{ role: 'lecteur_global' }], 'court-11-ch')
    expect(faible.status()).toBe(422)
    expect(JSON.stringify(await faible.json())).toContain('12')
    expect(await utilisateur(page.request, 'mdp.faible@exemple.invalid')).toBeUndefined()

    const u = (await utilisateur(page.request, EMAIL.anonyme))!
    expect((await modifier(page.request, u.id, { password: 'court' })).status()).toBe(422)
    const s = await session(browser, baseURL, EMAIL.anonyme)
    await s.context.close()

    const NOUVEAU = '<mot-de-passe-test-n3>'
    expect((await modifier(page.request, u.id, { password: NOUVEAU })).status()).toBe(200)
    const ancien = await browser.newContext({ baseURL })
    const refus = await ancien.request.post('api/v1/auth/login', { data: { email: EMAIL.anonyme, password: MDP } })
    expect(refus.status()).toBe(401)
    await ancien.close()
    const s2 = await session(browser, baseURL, EMAIL.anonyme, NOUVEAU)
    await s2.context.close()
  })

  test('création refusée : e-mail déjà utilisé (même en majuscules), nom manquant', async ({ page }) => {
    const avant = (await utilisateurs(page.request)).length
    expect((await creer(page.request, EMAIL.admin, 'Doublon', [{ role: 'lecteur_global' }])).status()).toBe(409)
    expect((await creer(page.request, 'ADMIN.RECETTE@exemple.invalid', 'Doublon', [{ role: 'lecteur_global' }])).status()).toBe(409)
    const sansNom = await page.request.post('api/v1/users', { data: { email: 'sans.nom@exemple.invalid', password: MDP, roles: [{ role: 'lecteur_global' }] } })
    expect(sansNom.status()).toBe(422)
    expect((await utilisateurs(page.request)).length).toBe(avant)
  })

  test('création refusée : adresse e-mail invalide', async ({ page }) => {
    // Défaut de l'application : le format de l'adresse n'est pas contrôlé (compte créé avec « pas-un-email »).
    test.fail()
    const rep = await creer(page.request, 'pas-un-email', 'Adresse invalide', [{ role: 'lecteur_global' }])
    if (rep.status() === 201) await page.request.delete(`api/v1/users/${((await rep.json()) as User).id}`)
    expect(rep.status()).toBe(422)
  })

  test('administrateurs : se désactiver est possible s’il en reste un autre, le dernier est protégé', async ({ page, browser, baseURL }) => {
    const moi = (await lireJson<{ id: number }>(page.request, 'auth/me')).id
    const temp = (await utilisateur(page.request, EMAIL.admin))!
    const admin2 = (await utilisateur(page.request, 'admin2@exemple.invalid'))!

    // Un administrateur peut se désactiver tant qu'il en reste d'autres actifs
    const s = await session(browser, baseURL, EMAIL.admin)
    expect((await modifier(s.page.request, temp.id, { actif: false })).status()).toBe(200)
    expect((await s.page.request.get('api/v1/auth/me')).status()).toBe(401)
    await s.context.close()
    expect((await utilisateur(page.request, EMAIL.admin))!.actif).toBe(false)

    try {
      // admin2 désactivé : « admin » devient le seul administrateur actif
      expect((await modifier(page.request, admin2.id, { actif: false })).status()).toBe(200)
      const refus = [
        await modifier(page.request, moi, { actif: false }),
        await modifier(page.request, moi, { roles: [{ role: 'lecteur_global', nominatif: true }] }),
        await page.request.delete(`api/v1/users/${moi}`),
      ]
      expect(refus.map((r) => r.status())).toEqual([409, 409, 409])
      expect(await refus[0].json()).toMatchObject({ detail: expect.stringContaining('au moins un administrateur') })
      expect(await refus[2].json()).toMatchObject({ detail: expect.stringContaining('Auto-suppression') })
      const encore = (await utilisateur(page.request, ADMIN))!
      expect(encore.actif).toBe(true)
      expect(encore.roles.map((r) => r.role)).toEqual(['rh_admin'])
    } finally {
      expect((await modifier(page.request, admin2.id, { actif: true })).status()).toBe(200)
    }
    expect((await utilisateur(page.request, 'admin2@exemple.invalid'))!.actif).toBe(true)
  })

  test('journal d’audit : créations, modifications et connexions tracées', async ({ page }) => {
    const u = (await utilisateur(page.request, EMAIL.admin))!
    const lignes = await journal(page.request, `entite=utilisateur&entite_id=${u.id}`)
    const actions = lignes.map((l) => l.action)
    expect(actions).toContain('create')
    expect(actions).toContain('update')
    expect(actions).toContain('login')
    const creation = lignes.find((l) => l.action === 'create')!
    expect(creation.avant).toBeNull()
    expect(creation.apres).toMatchObject({ email: EMAIL.admin, nom: 'Admin Recette' })
    const desactivation = lignes.find((l) => l.action === 'update')!
    expect(desactivation.avant.actif).toBe(true)
    expect(desactivation.apres.actif).toBe(false)
    expect(desactivation.utilisateur_id).toBe(u.id)

    const perimetres = await journal(page.request, `entite=perimetre&entite_id=${perimetrePneu.id}`)
    expect(perimetres.some((l) => l.action === 'create' && l.apres.code === 'RECETTE_PNEU')).toBe(true)
    // Pagination
    expect((await journal(page.request, 'limit=2')).length).toBe(2)
  })
})
