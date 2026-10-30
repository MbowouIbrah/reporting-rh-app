import { expect, type Page, test } from '@playwright/test'
import { ADMIN, connecter, lireJson, ouvrirSaisie, ouvrirVolet, reinitialiserFiltres } from './outils'

type Ligne = { matricule: string; nom: string; service: string; montants: Record<string, string>; total: string }
type Mois = { rubriques: { libelle: string; unite: string }[]; lignes: Ligne[] }
type Tableau = { colonnes: string[]; exclues: string[]; lignes: (Ligne & { annee: number; mois: number })[] }

const AOUT = 'donnees?annee=2026&mois=8'
const tableau = (page: Page, qs = 'annee=2026&mois=8') => lireJson<Tableau>(page.request, `donnees/tableau?${qs}`)
const motif = (v: string) => new RegExp(String(Math.round(Number(v))).replace(/\B(?=(\d{3})+$)/g, '[\\s\\u00a0\\u202f]?'))
const nombre = (v: string | undefined) => Number((v ?? '0').replace(',', '.'))

// Cible de la correction : un employé d'août, une rubrique en FCFA comptée dans le total
const cible: { matricule: string; nom: string; rubrique: string; avant: string; apres: string; totalAvant: number } = {
  matricule: '', nom: '', rubrique: '', avant: '', apres: '', totalAvant: 0,
}

test.describe.serial('feuille DONNEES et correction de données', () => {
  test.beforeEach(async ({ page }) => {
    await connecter(page, ADMIN)
  })

  test('la feuille DONNEES reprend les lignes importées et se filtre', async ({ page }) => {
    const api = await tableau(page)
    expect(api.lignes.length).toBeGreaterThan(10)
    await page.goto('admin')
    await expect(page.getByRole('heading', { name: 'ADMINISTRATION DES DONNÉES' })).toBeVisible({ timeout: 20_000 })
    await reinitialiserFiltres(page)
    await page.getByRole('combobox', { name: 'Année', exact: true }).selectOption('2026')
    await page.getByRole('combobox', { name: 'Mois', exact: true }).selectOption({ label: 'Août' })

    // Une ligne affichée = une ligne de l'API : matricule, nom et service identiques
    const un = api.lignes[0]
    const rang = page.getByRole('row', { name: new RegExp(`\\b${un.matricule}\\b`) }).first()
    await expect(rang).toContainText(un.nom)
    await expect(rang).toContainText(un.service)
    expect(api.lignes.every((l) => l.annee === 2026 && l.mois === 8)).toBe(true)

    // Filtre par service : les lignes de l'API suivent
    const service = un.service
    await page.getByLabel('Service').selectOption(service)
    const filtre = await tableau(page, `annee=2026&mois=8&service=${encodeURIComponent(service)}`)
    expect(filtre.lignes.length).toBeGreaterThan(0)
    expect(filtre.lignes.length).toBeLessThan(api.lignes.length)
    expect(filtre.lignes.every((l) => l.service === service)).toBe(true)
    await expect(page.getByRole('row', { name: new RegExp(`\\b${un.matricule}\\b`) }).first()).toBeVisible()

    // Le total d'une ligne est la somme des rubriques non exclues du total
    const somme = api.colonnes.filter((c) => !api.exclues.includes(c)).reduce((s, c) => s + nombre(un.montants[c]), 0)
    expect(nombre(un.total)).toBeCloseTo(somme, 2)
    await reinitialiserFiltres(page)
  })

  test('correction d’une valeur d’août : la grille reprend la ligne ; « Garder » ne change rien, « Remplacer » met la ligne à jour sans doublon', async ({ page }) => {
    test.slow() // deux enregistrements successifs : dépasse le délai par défaut
    const mois = await lireJson<Mois>(page.request, AOUT)
    const exclues = (await tableau(page)).exclues
    const compte = (r: { libelle: string; unite: string }, x: Ligne) => r.unite === 'FCFA' && !exclues.includes(r.libelle) && nombre(x.montants[r.libelle]) > 0
    const l = mois.lignes.find((x) => mois.rubriques.filter((r) => compte(r, x)).length >= 2)!
    const rub = mois.rubriques.find((r) => compte(r, l))!.libelle
    const avant = nombre(l.montants[rub])
    Object.assign(cible, { matricule: l.matricule, nom: l.nom, rubrique: rub, avant: l.montants[rub], apres: String(avant + 1000), totalAvant: nombre(l.total) })
    const lignesAvant = (await tableau(page)).lignes.length
    const mensuelAvant = JSON.stringify(await lireJson(page.request, 'rapports/mensuel?annee=2026&mois=8'))

    // Une seule ligne dans la grille : l'employé corrigé, avec une seule valeur retapée
    const saisir = async () => {
      await ouvrirSaisie(page)
      await page.getByRole('combobox', { name: 'Mois', exact: true }).selectOption({ label: 'Août' })
      await page.getByRole('button', { name: /Étape 1 : choisir les employés/ }).click()
      await page.getByRole('button', { name: 'Tout décocher' }).click()
      await page.getByRole('searchbox').fill(cible.matricule)
      await page.getByRole('button', { name: 'Tout cocher' }).click()
      await page.getByRole('button', { name: 'Continuer : saisir les montants (1) →' }).click()
      await expect(page.getByRole('heading', { name: 'SAISIE DES MONTANTS — AOÛT 2026' })).toBeVisible()
      await expect(page.getByRole('textbox', { name: `${rub}, ${cible.nom}` })).not.toHaveValue('')
      await page.getByRole('textbox', { name: `${rub}, ${cible.nom}` }).fill(cible.apres)
      await page.getByRole('button', { name: 'Enregistrer…' }).click()
      await expect(page.getByRole('heading', { name: /VÉRIFICATION AVANT ENREGISTREMENT/ })).toBeVisible()
      await expect(page.getByText('0 montant enregistré vidé en cas de remplacement')).toBeVisible()
      await ouvrirVolet(page, /Lignes à mettre à jour/)
      await expect(page.getByText(`${rub} : `).first()).toBeVisible()
    }

    // 1) « Garder » : rien n'est écrit
    await saisir()
    await page.getByRole('radio', { name: 'Garder' }).check()
    await page.getByRole('button', { name: 'Terminer sans rien changer' }).click()
    await expect(page.getByRole('heading', { name: 'ADMINISTRATION DES DONNÉES' })).toBeVisible({ timeout: 20_000 })
    const inchange = (await tableau(page)).lignes.find((x) => x.matricule === cible.matricule)!
    expect(nombre(inchange.montants[rub])).toBe(avant)
    expect(nombre(inchange.total)).toBeCloseTo(cible.totalAvant, 2)

    // 2) « Remplacer » : la ligne est remplacée
    await saisir()
    await page.getByRole('radio', { name: 'Remplacer' }).check()
    await page.getByRole('button', { name: 'Enregistrer 1 ligne' }).click()
    await expect(page.getByRole('heading', { name: 'ADMINISTRATION DES DONNÉES' })).toBeVisible({ timeout: 20_000 })
    const apres = await tableau(page)
    expect(apres.lignes.length).toBe(lignesAvant)
    expect(apres.lignes.filter((x) => x.matricule === cible.matricule)).toHaveLength(1)
    const nouvelle = apres.lignes.find((x) => x.matricule === cible.matricule)!
    expect(nombre(nouvelle.montants[rub])).toBe(avant + 1000)
    expect(nombre(nouvelle.total)).toBeCloseTo(cible.totalAvant + 1000, 2)
    // Les autres montants de la ligne restent tels quels (la grille reprend les valeurs enregistrées)
    for (const r of mois.rubriques.filter((x) => x.libelle !== rub)) expect(nouvelle.montants[r.libelle] ?? null).toBe(l.montants[r.libelle] ?? null)

    // Les rapports suivent
    expect(JSON.stringify(await lireJson(page.request, 'rapports/mensuel?annee=2026&mois=8'))).not.toBe(mensuelAvant)
  })

  test('la correction apparaît dans la feuille DONNEES et dans le journal d’audit', async ({ page }) => {
    await page.goto('admin')
    await reinitialiserFiltres(page)
    await page.getByRole('combobox', { name: 'Année', exact: true }).selectOption('2026')
    await page.getByRole('combobox', { name: 'Mois', exact: true }).selectOption({ label: 'Août' })
    const rang = page.getByRole('row', { name: new RegExp(`\\b${cible.matricule}\\b`) }).first()
    await expect(rang).toContainText(cible.nom)
    await expect(rang).toContainText(motif(cible.apres))
    await reinitialiserFiltres(page)

    const audit = await lireJson<{ action: string; entite: string; utilisateur?: string }[]>(page.request, 'audit?limit=500')
    const valides = audit.filter((a) => a.action === 'import_valide')
    expect(valides.length).toBeGreaterThanOrEqual(1)
    expect(audit.some((a) => a.action === 'import_analyse')).toBe(true)
  })
})
