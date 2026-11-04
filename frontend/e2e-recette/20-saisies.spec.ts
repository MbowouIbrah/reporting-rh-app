import { expect, type APIRequestContext, type Page, test } from '@playwright/test'
import { ADMIN, choisirPeriode, connecter, lireJson } from './outils'

// Mois de travail : juillet 2026 existe (import du spec 10) ; septembre reste vide, il sert au brouillon.
const ANNEE = 2026
const JUILLET = 7

type Axe = 'rubrique' | 'service' | 'site'
type Cible = { cible_id: number; libelle: string; valeur: string | null }
type Pilotage = {
  periode_id: number | null
  ca: string | null
  marge: string | null
  taux_marge: string | null
  budgets: Record<Axe, Cible[]>
  reprise: unknown
}

const pilotage = (r: APIRequestContext, mois = JUILLET) => lireJson<Pilotage>(r, `pilotage?annee=${ANNEE}&mois=${mois}`)
const budget = (v: Pilotage, axe: Axe, libelle: string) => {
  const c = v.budgets[axe].find((x) => x.libelle === libelle)
  expect(c, `${axe} ${libelle}`).toBeDefined()
  return c!
}
const valeur = (v: Pilotage, axe: Axe, libelle: string) => budget(v, axe, libelle).valeur
// Les champs affichent les montants groupés par milliers (espaces)
const groupe = (n: string) => new RegExp('^' + n.replace(/\B(?=(\d{3})+$)/g, '\\s') + '$')
const num = (s: string | null) => (s === null ? null : Number(s))

async function ouvrirMois(page: Page, mois: string) {
  await page.goto('admin/saisie')
  await expect(page.getByRole('heading', { name: 'RENSEIGNER DES DONNÉES' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Année', exact: true }).selectOption('2026')
  await page.getByRole('combobox', { name: 'Mois', exact: true }).selectOption({ label: mois })
  await expect(page.getByRole('button', { name: `Saisir les budgets de ${mois} 2026 →` })).toBeVisible()
}

// Page dédiée aux données du mois (CA et marge, activité, objectifs), ouverte depuis la page de départ.
async function ouvrirDonnees(page: Page, mois: string) {
  await ouvrirMois(page, mois)
  await page.getByRole('button', { name: `Saisir les données de ${mois} 2026 →` }).click()
  await expect(page.getByRole('heading', { level: 2, name: `DONNÉES — ${mois.toUpperCase()} 2026` })).toBeVisible()
}

// Grille « CA et marge » au niveau global : une seule ligne, deux cases, un bouton Enregistrer.
const champCa = (page: Page) => page.getByRole('textbox', { name: 'CA : Global' })
const champMarge = (page: Page) => page.getByRole('textbox', { name: 'Marge : Global' })
const enregistrerCa = (page: Page) => page.getByRole('button', { name: 'Enregistrer', exact: true })
const tauxEnregistre = (page: Page) => page.getByRole('row', { name: /^TOTAL/ }).getByRole('cell').last()
const invalide = (page: Page) => page.locator('.erreur-case', { hasText: 'Valeur invalide' })

async function ouvrirBudgets(page: Page, mois: string) {
  await ouvrirMois(page, mois)
}

async function saisirCaMarge(page: Page, ca: string, marge: string) {
  await champCa(page).fill(ca)
  await champMarge(page).fill(marge)
  await enregistrerCa(page).click()
  await expect(page.getByText('Enregistré.', { exact: true })).toBeVisible()
}

// Même enregistrement que la grille : un seul niveau (global), les deux indicateurs de la case.
const putCaMarge = (r: APIRequestContext, ca: string | null, marge: string | null) =>
  r.put('api/v1/pilotage/saisies', {
    data: { annee: ANNEE, mois: JUILLET, groupe: 'ca_marge', niveau: 'global', cases: [{ site_id: null, service_id: null, valeurs: { ca, marge } }] },
  })

async function ligneResume(page: Page, mois: string) {
  await page.goto('resume')
  const ligne = page.getByRole('row', { name: new RegExp(`^${mois}`) })
  await expect(ligne).toBeVisible()
  return ligne
}

test.describe.serial('saisies de pilotage', () => {
  test.beforeEach(async ({ page }) => {
    await connecter(page, ADMIN)
  })

  test('CA et marge : saisie normale, visible dans le Résumé', async ({ page }) => {
    const avant = await pilotage(page.request)
    expect(avant.ca).toBeNull()
    expect(avant.marge).toBeNull()

    await ouvrirDonnees(page, 'Juillet')
    await expect(champCa(page)).toHaveValue('')
    await expect(enregistrerCa(page)).toBeDisabled()
    await saisirCaMarge(page, '2100000000', '315000000')
    await expect(tauxEnregistre(page)).toHaveText(/^15\s%$/)

    const apres = await pilotage(page.request)
    expect(num(apres.ca)).toBe(2100000000)
    expect(num(apres.marge)).toBe(315000000)
    expect(num(apres.taux_marge)).toBeCloseTo(0.15, 6)

    // Le Résumé suit : ligne de juillet du suivi mensuel (CA, marge, taux)
    const ligne = await ligneResume(page, 'Juillet')
    await expect(ligne).toContainText(/2\s100\s000\s000/)
    await expect(ligne).toContainText(/315\s000\s000/)
    await expect(ligne).toContainText(/15\s%/)

    // Et le rapport mensuel de l'API
    const m = await lireJson(page.request, `rapports/mensuel?annee=${ANNEE}&mois=${JUILLET}`)
    expect(num(m.synthese.ca)).toBe(2100000000)
    expect(num(m.synthese.marge)).toBe(315000000)
  })

  test('CA et marge : décimales gardées, marge négative acceptée', async ({ page }) => {
    await ouvrirDonnees(page, 'Juillet')
    await expect(champCa(page)).toHaveValue(groupe('2100000000'))
    await saisirCaMarge(page, '2100000000,5', '315000000,25')
    let v = await pilotage(page.request)
    expect(Number(v.ca)).toBe(2100000000.5)
    expect(Number(v.marge)).toBe(315000000.25)

    await saisirCaMarge(page, '2100000000,5', '-50000000')
    await expect(tauxEnregistre(page)).toHaveText(/^[-−]2,4\s%$/)
    v = await pilotage(page.request)
    expect(Number(v.marge)).toBe(-50000000)
    expect(Number(v.taux_marge)).toBeLessThan(0)

    const ligne = await ligneResume(page, 'Juillet')
    await expect(ligne).toContainText(/[-−]50\s000\s000/)
    // L'écran arrondit à l'unité (2100000000,5 s'affiche 2 100 000 001), la valeur exacte reste en base
    await expect(ligne).toContainText(/2\s100\s000\s001/)

    // Retour à une marge normale pour la suite de la recette
    const rep = await putCaMarge(page.request, '2100000000', '315000000')
    expect(rep.status()).toBe(200)
  })

  test('CA et marge : erreurs de saisie, rien n’est enregistré', async ({ page }) => {
    const avant = await pilotage(page.request)
    await ouvrirDonnees(page, 'Juillet')
    await expect(champCa(page)).toHaveValue(groupe('2100000000'))

    // Marge sans CA : refusée par le serveur à l'enregistrement, le message s'affiche sous la grille
    await champCa(page).fill('')
    await enregistrerCa(page).click()
    await expect(page.getByRole('alert').filter({ hasText: 'sans chiffre d' })).toBeVisible()
    // Montant non numérique : erreur sur la case, enregistrement bloqué
    await champCa(page).fill('abc')
    await expect(invalide(page)).toBeVisible()
    await expect(page.getByText('1 valeur invalide', { exact: false })).toBeVisible()
    await expect(enregistrerCa(page)).toBeDisabled()
    // CA négatif
    await champCa(page).fill('-5')
    await expect(invalide(page)).toBeVisible()
    await expect(enregistrerCa(page)).toBeDisabled()
    // Marge non numérique
    await champCa(page).fill('2100000000')
    await expect(invalide(page)).toHaveCount(0)
    await champMarge(page).fill('douze')
    await expect(invalide(page)).toBeVisible()
    await expect(enregistrerCa(page)).toBeDisabled()
    // Deux cases invalides : le compte au pluriel
    await champCa(page).fill('abc')
    await expect(page.getByText('2 valeurs invalides', { exact: false })).toBeVisible()
    await champCa(page).fill('2100000000')
    // Marge supérieure au CA : acceptée, non bloquante
    await champMarge(page).fill('3000000000')
    await expect(invalide(page)).toHaveCount(0)
    await expect(enregistrerCa(page)).toBeEnabled()

    // Même refus côté serveur
    const sansCa = await putCaMarge(page.request, null, '100')
    expect(sansCa.status()).toBe(422)
    expect((await sansCa.json()).detail).toContain('sans chiffre d')
    expect((await putCaMarge(page.request, 'abc', null)).status()).toBe(422)
    expect((await putCaMarge(page.request, '-5', null)).status()).toBe(422)
    expect((await putCaMarge(page.request, '1000', 'douze')).status()).toBe(422)

    const apres = await pilotage(page.request)
    expect(apres.ca).toBe(avant.ca)
    expect(apres.marge).toBe(avant.marge)
  })

  test('budgets : reprise de juin, modification, enregistrement', async ({ page }) => {
    const avant = await pilotage(page.request)
    for (const axe of ['service', 'site', 'rubrique'] as const) expect(avant.budgets[axe].every((x) => x.valeur === null), axe).toBe(true)
    expect(avant.reprise).not.toBeNull()

    await ouvrirBudgets(page, 'Juillet')
    await expect(page.getByText(/Aucun budget pour Juillet 2026 : ceux de Juin 2026 pourront servir de point de départ\./)).toBeVisible()
    await page.getByRole('button', { name: 'Saisir les budgets de Juillet 2026 →' }).click()
    await expect(page.getByRole('heading', { name: 'BUDGETS — JUILLET 2026' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Aucun budget pour Juillet 2026' })).toBeVisible()

    await page.getByRole('button', { name: 'Reprendre les budgets de Juin' }).click()
    await expect(page.getByLabel('Budget Commerce VN (services)')).toHaveValue(groupe('5000000'))
    await expect(page.getByLabel('Budget Douala (sites)')).toHaveValue(groupe('3800000'))
    await expect(page.getByLabel('Budget Formation (types de charge)')).toHaveValue(groupe('150000'))
    await expect(page.getByText(/\d+ budgets modifiés, non enregistrés\./)).toBeVisible()
    // La reprise n'écrit rien tant qu'on n'a pas enregistré
    expect((await pilotage(page.request)).budgets.service.every((x) => x.valeur === null)).toBe(true)

    // Par service, par site (dont un nouveau) et par rubrique
    await page.getByLabel('Budget Commerce VN (services)').fill('5123456')
    await page.getByLabel('Budget Douala (sites)').fill('3900000')
    await page.getByLabel('Budget Yaoundé (sites)').fill('2500000')
    await page.getByLabel('Budget Formation (types de charge)').fill('200000')
    await page.getByRole('button', { name: 'Vérifier avant d’enregistrer' }).click()
    await expect(page.getByRole('heading', { name: 'VÉRIFICATION AVANT ENREGISTREMENT — BUDGETS JUILLET 2026' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Budgets (26)' })).toBeVisible()
    const detail = page.locator('details', { has: page.getByText(/^Changements \(26\)/) })
    if (!(await detail.evaluate((e: HTMLDetailsElement) => e.open))) await detail.locator('summary').click()
    await expect(detail.getByRole('row', { name: /Commerce VN/ })).toContainText(/5\s123\s456/)
    await page.getByRole('button', { name: 'Enregistrer 26 budgets' }).click()
    await expect(page.getByText('Budgets enregistrés.')).toBeVisible()

    const apres = await pilotage(page.request)
    expect(valeur(apres, 'service', 'Commerce VN')).toBe('5123456.000')
    expect(valeur(apres, 'service', 'Administration')).toBe('5000000.000')
    expect(valeur(apres, 'site', 'Douala')).toBe('3900000.000')
    expect(valeur(apres, 'site', 'Yaoundé')).toBe('2500000.000')
    expect(valeur(apres, 'rubrique', 'Formation')).toBe('200000.000')
    expect(valeur(apres, 'rubrique', 'Primes exceptionnelles')).toBe('2000000.000')
    // Les budgets de juin ne bougent pas
    expect(valeur(await pilotage(page.request, 6), 'service', 'Commerce VN')).toBe('5000000.000')

    // Journal d'audit
    const audit = await lireJson<{ action: string; entite_id: string }[]>(page.request, 'audit')
    expect(audit.some((a) => a.action === 'saisie_budget' && a.entite_id === String(apres.periode_id))).toBe(true)

    // Le rapport mensuel de juillet affiche le budget du service
    const m = await lireJson(page.request, `rapports/mensuel?annee=${ANNEE}&mois=${JUILLET}`)
    const cv = m.b_service_activite.find((s: { service: string }) => s.service === 'Commerce VN')
    expect(num(cv.total.budget)).toBe(5123456)
    await page.goto('mensuel')
    await choisirPeriode(page, 'Juillet', ANNEE)
    await expect(page.getByRole('cell', { name: /5\s123\s456/ }).first()).toBeVisible()
  })

  test('budgets : montants invalides, décimales, effacement', async ({ page }) => {
    await ouvrirBudgets(page, 'Juillet')
    await page.getByRole('button', { name: 'Saisir les budgets de Juillet 2026 →' }).click()
    const cv = page.getByLabel('Budget Commerce VN (services)')
    const verifier = page.getByRole('button', { name: 'Vérifier avant d’enregistrer' })
    await expect(cv).toHaveValue(groupe('5123456'))
    const initial = await cv.inputValue()
    await expect(page.getByText('Aucune modification.')).toBeVisible()
    await expect(verifier).toBeDisabled()

    for (const faux of ['abc', '-100', '1234,5678']) {
      await cv.fill(faux)
      await expect(cv).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByText('1 montant invalide : chiffres, virgule et 3 décimales au plus.')).toBeVisible()
      await expect(verifier).toBeDisabled()
    }
    await cv.fill(initial)
    await expect(page.getByText('Aucune modification.')).toBeVisible()

    // Une décimale et un budget effacé
    await page.getByLabel('Budget Douala (sites)').fill('3900000,5')
    await page.getByLabel('Budget Yaoundé (sites)').fill('')
    await verifier.click()
    await expect(page.getByRole('heading', { name: 'Budgets (2)' })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: '1 budget enregistré sera effacé' })).toBeVisible()
    await page.getByRole('button', { name: 'Enregistrer 2 budgets' }).click()
    await expect(page.getByText('Budgets enregistrés.')).toBeVisible()
    const v = await pilotage(page.request)
    expect(valeur(v, 'site', 'Douala')).toBe('3900000.500')
    expect(valeur(v, 'site', 'Yaoundé')).toBeNull()
    expect(valeur(v, 'service', 'Commerce VN')).toBe('5123456.000')

    // Refus côté serveur : aucune ligne n'est écrite
    const cible = budget(v, 'service', 'Commerce VN').cible_id
    const put = (lignes: unknown[]) => page.request.put('api/v1/pilotage/budgets', { data: { annee: ANNEE, mois: JUILLET, lignes } })
    expect((await put([{ axe: 'service', cible_id: cible, valeur: 'abc' }])).status()).toBe(422)
    expect((await put([{ axe: 'service', cible_id: cible, valeur: '-5' }])).status()).toBe(422)
    expect((await put([{ axe: 'service', cible_id: cible, valeur: '1' }, { axe: 'service', cible_id: cible, valeur: '2' }])).status()).toBe(422)
    expect((await put([{ axe: 'service', cible_id: 999999, valeur: '1' }])).status()).toBe(422)
    expect(valeur(await pilotage(page.request), 'service', 'Commerce VN')).toBe('5123456.000')
  })

  test('objectifs d’activité : objectif annuel réparti sur les 12 mois', async ({ page }) => {
    await ouvrirDonnees(page, 'Juillet')
    await page.getByRole('tab', { name: 'Objectifs d’activité' }).click()
    // La base de recette a déjà 1 200 ventes sur 2026 (100 par mois)
    const ventes = page.getByRole('textbox', { name: 'Objectif ventes : Global' })
    await expect(ventes).toHaveValue('100')

    await page.getByRole('button', { name: 'Répartir un objectif annuel' }).click()
    await page.getByRole('textbox', { name: 'Objectif ventes annuel : Global' }).fill('2400')
    await page.getByRole('button', { name: 'Répartir sur 12 mois' }).click()
    await expect(page.getByText('Objectifs 2026 répartis sur les 12 mois ; 12 mois déjà saisis remplacés.')).toBeVisible()
    await expect(ventes).toHaveValue('200')
  })

  test('brouillon de saisie : gardé après rechargement, repris, abandonné', async ({ page }) => {
    await ouvrirMois(page, 'Septembre')
    await page.getByRole('button', { name: 'Étape 1 : choisir les employés de Septembre 2026 →' }).click()
    await page.getByRole('button', { name: 'Tout cocher' }).click()
    await page.getByRole('button', { name: /^Continuer : saisir les montants \(\d+\) →$/ }).click()
    const grille = page.getByRole('region', { name: 'Grille de saisie' })
    const champ = () => grille.getByRole('textbox', { name: /^Crédit téléphonique, / }).first()
    await champ().fill('4321')
    await expect(champ()).toHaveValue('4321')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('saisie:2026-09'))).not.toBeNull()

    await page.reload()
    await ouvrirMois(page, 'Septembre')
    await page.getByRole('button', { name: 'Étape 1 : choisir les employés de Septembre 2026 →' }).click()
    await expect(page.getByText(/Une saisie non enregistrée existe pour ce mois/)).toBeVisible()
    await page.getByRole('button', { name: 'Reprendre cette saisie' }).click()
    await expect(champ()).toHaveValue('4321')

    // Rien n'a été enregistré côté serveur : septembre reste vide
    const periodes = await lireJson<{ annee: number; mois: number }[]>(page.request, 'rapports/periodes')
    expect(periodes.some((p) => p.annee === ANNEE && p.mois === 9)).toBe(false)

    await page.getByRole('button', { name: 'Retour : Employés concernés' }).click()
    await page.getByRole('button', { name: 'L’abandonner' }).click()
    await expect(page.getByText(/Une saisie non enregistrée existe pour ce mois/)).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('saisie:2026-09'))).toBeNull()
  })
})
