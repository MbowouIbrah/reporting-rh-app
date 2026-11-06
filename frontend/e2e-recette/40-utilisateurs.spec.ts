import { expect, type APIRequestContext, type Browser, type Page, test } from '@playwright/test'
import { ADMIN, compte, connecter, courriel, lireJson, motDePasse } from './outils'

// Gestion des utilisateurs : pas d'écran, tout passe par l'API d'administration ; on contrôle ensuite ce que
// voit chaque nouveau compte dans l'application.
const MDP = motDePasse()
const CHOISI = motDePasse()
const BASE_ONGLETS = ['Résumé', 'Graphes', 'Annuel', 'Mensuel', 'Individuel']
const TOUS = ['Administration', 'Commerce Pièces', 'Commerce VN', 'Pneumatique', 'SAV Engins', 'SAV PL', 'Sites Déportés']

const EMAIL = {
  admin: courriel('admin.recette'),
  global: courriel('lecteur.global'),
  anonyme: courriel('lecteur.anonyme'),
  perimetre: courriel('lecteur.perimetre'),
  perimetreNominatif: courriel('lecteur.perimetre.nominatif'),
}

type Portee = { tout?: boolean; perimetres?: number[]; services?: string[]; sites?: string[] }
type Droits = { fonction?: string; permissions?: string[]; portee?: Portee }
type User = { id: number; email: string; nom: string; fonction: string; actif: boolean; doit_changer_mdp: boolean; permissions: string[]; portee: Required<Portee> }
type Audit = { id: number; action: string; entite: string; entite_id: string; utilisateur_id: number | null; avant: any; apres: any }
type Perimetre = { id: number; code: string; libelle: string; regles: { dimension: string; valeur: string }[] }

const utilisateurs = (r: APIRequestContext) => lireJson<User[]>(r, 'users')
const utilisateur = async (r: APIRequestContext, email: string) => (await utilisateurs(r)).find((u) => u.email === email)
const creer = (r: APIRequestContext, email: string, nom: string, droits: Droits, password = MDP) =>
  r.post('api/v1/users', { data: { email, nom, password, ...droits } })
const TOUTES = ['comptes', 'import', 'journal', 'marge', 'nominatif', 'referentiel', 'saisie']
const ADMIN_DROITS: Droits = { fonction: 'Administrateur RH', permissions: TOUTES, portee: { tout: true } }
const GLOBAL: Portee = { tout: true }
const portee = (p: Portee): Required<Portee> => ({ tout: false, perimetres: [], services: [], sites: [], ...p })
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
  await expect(page.locator('.tuile .micro', { hasText: /^Marge$/ })).toHaveCount(attendus.marge ? 1 : 0)
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
    const rep = await creer(page.request, courriel('Admin.Recette'), 'Admin Recette', ADMIN_DROITS)
    expect(rep.status()).toBe(201)
    const cree = (await rep.json()) as User
    expect(cree).toMatchObject({ email: EMAIL.admin, nom: 'Admin Recette', fonction: 'Administrateur RH', actif: true })
    expect(cree.permissions).toEqual(TOUTES)
    expect(cree.portee).toEqual(portee({ tout: true }))

    const { context, page: p } = await session(browser, baseURL, courriel('Admin.Recette'))
    await voir(p, { onglets: [...BASE_ONGLETS, 'Administration'], services: TOUS, marge: true })
    await p.goto('admin')
    await expect(p.getByRole('heading', { name: /ADMINISTRATION DES DONNÉES/ })).toBeVisible()
    expect((await p.request.get('api/v1/users')).status()).toBe(200)
    expect((await p.request.get('api/v1/audit')).status()).toBe(200)
    await context.close()
  })

  test('lecteur global : voit tout ; noms et marge seulement s’ils sont accordés', async ({ page, browser, baseURL }) => {
    expect((await creer(page.request, EMAIL.global, 'Lecteur Global', { fonction: 'Lecteur global', permissions: ['marge', 'nominatif'], portee: GLOBAL })).status()).toBe(201)
    expect((await creer(page.request, EMAIL.anonyme, 'Lecteur Anonyme', { permissions: ['marge'], portee: GLOBAL })).status()).toBe(201)

    const nominatif = await session(browser, baseURL, EMAIL.global)
    await voir(nominatif.page, { onglets: BASE_ONGLETS, services: TOUS, marge: true })
    await nominatif.page.goto('individuel')
    await expect(nominatif.page.getByRole('region', { name: 'Reporting individuel' })).toBeVisible()
    await nominatif.page.goto('admin')
    // Page non accordée : redirection vers le résumé (pas de 403 affiché)
    await expect(nominatif.page).toHaveURL(/resume$/)
    expect((await nominatif.page.request.get('api/v1/users')).status()).toBe(403)
    await nominatif.context.close()

    // Toutes les données sans « Voir les noms » : pas d'individuel ; la marge reste, elle est accordée
    const anonyme = await session(browser, baseURL, EMAIL.anonyme)
    await voir(anonyme.page, { onglets: BASE_ONGLETS.slice(0, 4), services: TOUS, marge: true })
    expect((await anonyme.page.request.get('api/v1/rapports/salaries?annee=2026')).status()).toBe(403)
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

    const rep = await creer(page.request, EMAIL.perimetre, 'Lecteur Périmètre', { portee: { perimetres: [perimetrePneu.id] } })
    expect(rep.status()).toBe(201)
    expect((await rep.json()) as User).toMatchObject({ permissions: [], portee: portee({ perimetres: [perimetrePneu.id] }) })

    const { context, page: p } = await session(browser, baseURL, EMAIL.perimetre)
    await voir(p, { onglets: BASE_ONGLETS.slice(0, 4), services: ['Pneumatique'], marge: false })
    await expect(p.getByRole('heading', { name: '1. Reporting global' })).toBeVisible()
    await p.goto('individuel')
    // Page non accordée : redirection vers le résumé (pas de 403 affiché)
    await expect(p).toHaveURL(/resume$/)
    expect((await p.request.get('api/v1/rapports/salaries?annee=2026')).status()).toBe(403)
    // Les périmètres lisibles se limitent au sien
    const vus = await lireJson<Perimetre[]>(p.request, 'perimetres')
    expect(vus.map((x) => x.code)).toEqual(['RECETTE_PNEU'])
    expect((await p.request.get(`api/v1/perimetres/${perimetreSites.id}`)).status()).toBe(403)
    expect((await p.request.post('api/v1/perimetres', { data: { code: 'X', libelle: 'X' } })).status()).toBe(403)
    await context.close()

    // Même périmètre avec l'accès nominatif : l'individuel s'ouvre, jamais la marge
    expect((await creer(page.request, EMAIL.perimetreNominatif, 'Périmètre nominatif', { permissions: ['nominatif'], portee: { perimetres: [perimetrePneu.id] } })).status()).toBe(201)
    const n = await session(browser, baseURL, EMAIL.perimetreNominatif)
    await voir(n.page, { onglets: BASE_ONGLETS, services: ['Pneumatique'], marge: false })
    await n.context.close()
  })

  test('droits incohérents refusés : écriture ou marge sans toutes les données, permission ou valeur inconnue', async ({ page }) => {
    const avant = (await utilisateurs(page.request)).length
    const essai = async (email: string, droits: Droits) => (await creer(page.request, email, 'Essai', droits)).status()
    const pneu = { perimetres: [perimetrePneu.id] }
    expect(await essai(courriel('import.perimetre'), { permissions: ['import'], portee: pneu })).toBe(422)
    expect(await essai(courriel('marge.perimetre'), { permissions: ['marge'], portee: pneu })).toBe(422)
    expect(await essai(courriel('comptes.service'), { permissions: ['comptes'], portee: { services: ['Pneumatique'] } })).toBe(422)
    expect(await essai(courriel('permission.inconnue'), { permissions: ['super_admin'], portee: GLOBAL })).toBe(422)
    expect(await essai(courriel('perimetre.inconnu'), { portee: { perimetres: [99999] } })).toBe(422)
    expect(await essai(courriel('service.inconnu'), { portee: { services: ['Service fantôme'] } })).toBe(422)
    expect((await utilisateurs(page.request)).length).toBe(avant)
  })

  test('changement de périmètre, puis service accordé directement, puis toutes les données : visible à la reconnexion', async ({ page, browser, baseURL }) => {
    const u = (await utilisateur(page.request, EMAIL.perimetre))!

    const rep1 = await modifier(page.request, u.id, { portee: { perimetres: [perimetreSites.id] } })
    expect(rep1.status()).toBe(200)
    let s = await session(browser, baseURL, EMAIL.perimetre)
    await voir(s.page, { onglets: BASE_ONGLETS.slice(0, 4), services: ['Sites Déportés'], marge: false })
    await s.context.close()

    // Service accordé sans périmètre ; la fonction est un libellé, elle ne change aucun droit
    const repS = await modifier(page.request, u.id, { fonction: 'Directeur commercial VN', portee: { services: ['Commerce VN'] } })
    expect(repS.status()).toBe(200)
    expect((await repS.json()) as User).toMatchObject({ fonction: 'Directeur commercial VN', permissions: [], portee: portee({ services: ['Commerce VN'] }) })
    s = await session(browser, baseURL, EMAIL.perimetre)
    await voir(s.page, { onglets: BASE_ONGLETS.slice(0, 4), services: ['Commerce VN'], marge: false })
    await s.context.close()

    const rep2 = await modifier(page.request, u.id, { permissions: ['marge', 'nominatif'], portee: GLOBAL })
    expect(rep2.status()).toBe(200)
    s = await session(browser, baseURL, EMAIL.perimetre)
    await voir(s.page, { onglets: BASE_ONGLETS, services: TOUS, marge: true })
    await s.context.close()

    // Journal : avant / après du dernier changement de droits, sans mot de passe
    const lignes = await journal(page.request, `entite=utilisateur&entite_id=${u.id}`)
    const maj = lignes.filter((l) => l.action === 'update')
    expect(maj.length).toBeGreaterThanOrEqual(3)
    expect(maj[0].avant).toMatchObject({ permissions: [], portee: portee({ services: ['Commerce VN'] }) })
    expect(maj[0].apres).toMatchObject({ permissions: ['marge', 'nominatif'], portee: portee({ tout: true }) })
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
    await p.getByRole('group', { name: 'Connexion' }).getByLabel('Adresse e-mail').fill(EMAIL.global)
    await p.getByRole('group', { name: 'Connexion' }).getByLabel('Mot de passe', { exact: true }).fill(MDP)
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

  test('compte créé par un admin : changement imposé avant tout accès', async ({ page, browser, baseURL }) => {
    const email = courriel('provisoire')
    expect((await creer(page.request, email, 'Compte provisoire', { portee: GLOBAL })).status()).toBe(201)
    const context = await browser.newContext({ baseURL })
    const p = await context.newPage()
    await p.goto('login')
    await p.getByRole('group', { name: 'Connexion' }).getByLabel('Adresse e-mail').fill(email)
    await p.getByRole('group', { name: 'Connexion' }).getByLabel('Mot de passe', { exact: true }).fill(MDP)
    await p.getByRole('button', { name: 'Se connecter' }).click()
    const titre = p.getByRole('heading', { name: 'Changez votre mot de passe' })
    await expect(titre).toBeVisible()
    expect((await p.request.get('api/v1/rapports/periodes')).status()).toBe(403)
    await p.goto('resume')
    await expect(titre).toBeVisible()
    await p.getByLabel('Mot de passe actuel', { exact: true }).fill(MDP)
    await p.getByLabel('Nouveau mot de passe', { exact: true }).fill(CHOISI)
    await p.getByLabel('Confirmer le mot de passe', { exact: true }).fill(CHOISI)
    await p.getByRole('button', { name: 'Enregistrer le mot de passe' }).click()
    await expect(onglets(p).first()).toBeVisible()
    expect((await p.request.get('api/v1/rapports/periodes')).status()).toBe(200)
    await context.close()
  })

  test('mot de passe : trop court refusé à la création et au changement, nouveau mot de passe pris en compte', async ({ page, browser, baseURL }) => {
    const faible = await creer(page.request, courriel('mdp.faible'), 'Mot de passe faible', { portee: GLOBAL }, 'court-7')
    expect(faible.status()).toBe(422)
    expect(JSON.stringify(await faible.json())).toContain('8 caractères')
    expect(await utilisateur(page.request, courriel('mdp.faible'))).toBeUndefined()

    const u = (await utilisateur(page.request, EMAIL.anonyme))!
    expect((await modifier(page.request, u.id, { password: 'court' })).status()).toBe(422)
    const s = await session(browser, baseURL, EMAIL.anonyme)
    await s.context.close()

    const NOUVEAU = motDePasse()
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
    expect((await creer(page.request, EMAIL.admin, 'Doublon', { portee: GLOBAL })).status()).toBe(409)
    expect((await creer(page.request, courriel('admin.recette').toUpperCase(), 'Doublon', { portee: GLOBAL })).status()).toBe(409)
    const sansNom = await page.request.post('api/v1/users', { data: { email: courriel('sans.nom'), password: MDP, portee: GLOBAL } })
    expect(sansNom.status()).toBe(422)
    expect((await utilisateurs(page.request)).length).toBe(avant)
  })

  test('création refusée : adresse e-mail invalide', async ({ page }) => {
    const rep = await creer(page.request, 'pas-un-email', 'Adresse invalide', { portee: GLOBAL })
    if (rep.status() === 201) await page.request.delete(`api/v1/users/${((await rep.json()) as User).id}`)
    expect(rep.status()).toBe(422)
  })

  test('gestionnaires des comptes : jamais d’auto-retrait, le dernier actif est protégé', async ({ page, browser, baseURL }) => {
    const moi = (await lireJson<{ id: number }>(page.request, 'auth/me')).id
    const temp = (await utilisateur(page.request, EMAIL.admin))!
    const admin2 = (await utilisateur(page.request, compte('rh.partenaire').email))!

    // Son propre compte : ni désactivation, ni retrait de « Gérer les comptes », même s'il reste d'autres gestionnaires
    const s = await session(browser, baseURL, EMAIL.admin)
    const soi = await modifier(s.page.request, temp.id, { actif: false })
    expect(soi.status()).toBe(409)
    expect(await soi.json()).toMatchObject({ detail: expect.stringContaining('soi-même') })
    expect((await modifier(s.page.request, temp.id, { permissions: ['marge'] })).status()).toBe(409)
    await s.context.close()
    // Un autre gestionnaire peut le désactiver
    expect((await modifier(page.request, temp.id, { actif: false })).status()).toBe(200)

    try {
      // admin2 désactivé : « admin » reste le seul gestionnaire actif
      expect((await modifier(page.request, admin2.id, { actif: false })).status()).toBe(200)
      const refus = [
        await modifier(page.request, moi, { actif: false }),
        await modifier(page.request, moi, { permissions: ['marge', 'nominatif'] }),
        await page.request.delete(`api/v1/users/${moi}`),
      ]
      expect(refus.map((r) => r.status())).toEqual([409, 409, 409])
      expect(await refus[2].json()).toMatchObject({ detail: expect.stringContaining('Auto-suppression') })
      const encore = (await utilisateur(page.request, ADMIN))!
      expect(encore.actif).toBe(true)
      expect(encore.permissions).toEqual(TOUTES)
    } finally {
      expect((await modifier(page.request, admin2.id, { actif: true })).status()).toBe(200)
    }
    expect((await utilisateur(page.request, compte('rh.partenaire').email))!.actif).toBe(true)
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
    expect(desactivation.utilisateur_id).toBe((await lireJson<{ id: number }>(page.request, 'auth/me')).id)

    const perimetres = await journal(page.request, `entite=perimetre&entite_id=${perimetrePneu.id}`)
    expect(perimetres.some((l) => l.action === 'create' && l.apres.code === 'RECETTE_PNEU')).toBe(true)
    // Pagination
    expect((await journal(page.request, 'limit=2')).length).toBe(2)
  })
})
