import { expect, type Page, test } from '@playwright/test'

const PW = '<mot-de-passe-test>'

async function connecter(page: Page, email: string) {
  await page.goto('login')
  await page.getByRole('group', { name: 'Connexion' }).getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(PW)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('navigation', { name: 'Rapports' })).toBeVisible()
}

/** Collage tel qu'Excel le produit : TSV, espaces insécables, ligne vide finale. */
async function collerExcel(page: Page, nom: string, texte: string) {
  const cell = page.getByRole('textbox', { name: nom })
  await cell.focus()
  await cell.evaluate((el, t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, texte)
}

/** Page de départ de la saisie, sur le mois voulu (listes Année et Mois du bandeau « Période à renseigner »). */
async function choisirMois(page: Page, mois: string, annee = '2026') {
  const periode = page.getByRole('group', { name: 'Période à renseigner' })
  await periode.getByRole('combobox', { name: 'Année', exact: true }).selectOption(annee)
  await periode.getByRole('combobox', { name: 'Mois', exact: true }).selectOption({ label: mois })
}

test('renseigner un mois : cases, collage Excel, aperçu, enregistrement puis annulation', async ({ page }) => {
  await connecter(page, 'admin@exemple.invalid')
  await page.goto('admin')
  await page.getByRole('link', { name: 'Renseigner des données' }).click()
  await expect(page).toHaveURL(/admin\/saisie$/)
  await choisirMois(page, 'Mars')
  await page.getByRole('button', { name: 'Étape 1 : choisir les employés de Mars 2026 →' }).click()

  await page.getByRole('button', { name: 'Tout cocher' }).click()
  const ouvrir = page.getByRole('button', { name: /^Continuer : saisir les montants \(\d+\) →$/ })
  await page.screenshot({ path: 'test-results/saisie-choix.png' })
  await ouvrir.click()

  const premiere = page.getByRole('textbox', { name: /^Brut Réel, / }).first()
  await expect(premiere).toBeVisible()
  const nom = (await premiere.getAttribute('aria-label'))!
  await collerExcel(page, nom, '1 000,5\r\n2000\r\n')
  await expect(premiere).toHaveValue('1 000,5')
  const enregistrer = page.getByRole('button', { name: 'Enregistrer…' })
  await expect(enregistrer).toBeEnabled({ timeout: 5000 })
  await expect(page.locator('tbody tr').first().locator('td.total')).toHaveText(/1\s?000,5/)
  await page.screenshot({ path: 'test-results/saisie-grille.png' })
  await enregistrer.click()

  await expect(page.getByRole('heading', { name: /VÉRIFICATION AVANT ENREGISTREMENT/ })).toBeVisible()
  await page.screenshot({ path: 'test-results/saisie-apercu.png' })
  await page.getByRole('button', { name: /^Enregistrer \d+ lignes?$/ }).click()
  await expect(page).toHaveURL(/admin$/)
  await expect(page.getByText(/^Enregistré : \d+ ligne/)).toBeVisible()

  await page.getByRole('button', { name: 'Annuler cet enregistrement' }).click()
  await page.getByRole('button', { name: 'Annuler l’enregistrement' }).click()
  await expect(page.getByText(/Enregistrement annulé/)).toBeVisible()
})

test('employés ajoutés : nom proche d’un employé connu signalé, aucun identifiant technique visible', async ({ page }) => {
  await connecter(page, 'admin@exemple.invalid')
  await page.goto('admin/saisie')
  await choisirMois(page, 'Avril')
  await page.getByRole('button', { name: 'Étape 1 : choisir les employés de Avril 2026 →' }).click()

  // Nouveaux employés ajoutés à l'étape du choix ; matricule et nom sont obligatoires, les attributs sont choisis dans les listes.
  const ajouter = async (matricule: string, nom: string) => {
    await page.getByRole('button', { name: '+ Nouvel employé' }).click()
    const fiche = page.getByRole('form', { name: 'Nouvel employé' })
    await fiche.getByLabel('MATRICULE').fill(matricule)
    await fiche.getByLabel('Noms').fill(nom)
    const listes = fiche.getByRole('combobox')
    for (let i = 0; i < (await listes.count()); i++) await listes.nth(i).selectOption({ index: 1 })
    await fiche.getByRole('button', { name: 'Ajouter' }).click()
  }
  await ajouter('E99', 'ann') // matricule inconnu, nom d'un employé connu (E1)
  await ajouter('E98', 'Zoé Nouvelle')
  await page.getByRole('button', { name: /^Continuer : saisir les montants \(\d+\) →$/ }).click()

  // Le brut des deux nouveaux employés
  await page.getByRole('textbox', { name: 'Brut Réel, ann', exact: true }).fill('1500')
  await page.getByRole('textbox', { name: 'Brut Réel, Zoé Nouvelle', exact: true }).fill('800')

  const enregistrer = page.getByRole('button', { name: 'Enregistrer…' })
  await expect(enregistrer).toBeEnabled({ timeout: 5000 })
  await enregistrer.click()

  const detail = page.getByRole('region', { name: 'Détail de l\'aperçu' })
  // Volets repliés par défaut : le nombre de points figure dans leur titre
  await detail.getByRole('button', { name: /^Noms et matricules à vérifier .* 1$/ }).click()
  await expect(detail.getByText(/très proche de « Ann »/).first()).toBeVisible()
  await detail.getByRole('button', { name: /^Nouveaux employés .* 2$/ }).click()
  await expect(detail.getByText('Zoé Nouvelle').first()).toBeVisible()
  await expect(page.getByText(/SM-/)).toHaveCount(0)
  await page.screenshot({ path: 'test-results/saisie-apercu-noms.png', fullPage: true })

  await page.getByRole('button', { name: /^Enregistrer \d+ lignes?$/ }).click()
  await expect(page).toHaveURL(/admin$/)
  await expect(page.getByText(/^Enregistré : \d+ ligne/)).toBeVisible()
  await page.getByRole('button', { name: 'Annuler cet enregistrement' }).click()
  await page.getByRole('button', { name: 'Annuler l’enregistrement' }).click()
  await expect(page.getByText(/Enregistrement annulé/)).toBeVisible()
})

test('pilotage d’un mois sans paie : CA, marge et budgets ouvrent le mois', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 })
  await connecter(page, 'admin@exemple.invalid')
  await page.goto('admin/saisie')
  await choisirMois(page, 'Octobre')
  await expect(page.getByRole('heading', { name: 'DONNÉES DE OCTOBRE 2026' })).toBeVisible()

  // CA et marge : grille au niveau global (une ligne, deux cases)
  await page.getByRole('button', { name: 'Saisir les résultats financiers de Octobre 2026 →' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'DONNÉES — OCTOBRE 2026' })).toBeVisible()
  await page.getByRole('textbox', { name: 'CA : Global' }).fill('1 000 000')
  await page.getByRole('textbox', { name: 'Marge : Global' }).fill('-250 000')
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByText('Enregistré.', { exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: /^TOTAL/ }).getByRole('cell').last()).toHaveText(/^[-−]25(,0)?\s%$/)
  await page.screenshot({ path: 'test-results/saisie-pilotage.png', fullPage: true })

  await page.getByRole('button', { name: 'Retour : Choix du mois' }).click()
  await page.getByRole('button', { name: 'Saisir les budgets de Octobre 2026 →' }).click()
  await expect(page.getByRole('heading', { name: 'BUDGETS — OCTOBRE 2026' })).toBeVisible()
  const sites = page.getByRole('table', { name: /sites/ })
  await sites.getByRole('textbox').first().fill('12 000 000')
  await expect(sites.locator('tfoot td')).toHaveText(/12\s000\s000/)
  await page.screenshot({ path: 'test-results/saisie-budgets-grille.png' })
  await page.getByRole('button', { name: 'Vérifier avant d’enregistrer' }).click()
  await expect(page.getByRole('heading', { name: /VÉRIFICATION AVANT ENREGISTREMENT — BUDGETS OCTOBRE 2026/ })).toBeVisible()
  await page.screenshot({ path: 'test-results/saisie-budgets-verif.png' })
  await page.getByRole('button', { name: 'Enregistrer 1 budget' }).click()
  await expect(page.getByText('Budgets enregistrés.')).toBeVisible()
  await page.screenshot({ path: 'test-results/saisie-budgets.png' })

  await page.getByRole('button', { name: 'Retour : Choix du mois' }).click()
  const resume = page.getByText('Sites', { exact: true }).locator('xpath=..')
  await expect(resume).toContainText(/12\s000\s000\sFCFA/)
})

test('départ : deux façons de faire, retour en haut à gauche ; grille triable et filtrable', async ({ page }) => {
  await connecter(page, 'admin@exemple.invalid')
  await page.goto('admin')
  await page.getByRole('link', { name: 'Renseigner des données' }).click()
  await expect(page.getByRole('link', { name: 'Retour : Administration' })).toBeVisible()
  await choisirMois(page, 'Mai')
  await expect(page.getByRole('link', { name: 'Télécharger le modèle vide' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Importer un fichier (.xlsx)' })).toBeVisible()
  await page.screenshot({ path: 'test-results/saisie-depart.png' })
  await page.getByRole('button', { name: 'Étape 1 : choisir les employés de Mai 2026 →' }).click()
  await page.getByRole('button', { name: 'Tout cocher' }).click()
  await page.getByRole('button', { name: /^Continuer : saisir les montants \(\d+\) →$/ }).click()

  const grille = page.getByRole('region', { name: 'Grille de saisie' })
  const lignes = grille.locator('tbody tr')
  await expect(lignes.first()).toBeVisible()
  const total = await lignes.count()
  // Filtre par service : moins de lignes ; tri sur le nom.
  const service = page.getByRole('group', { name: 'Filtres de la grille' }).getByLabel('Service')
  const choix = await service.locator('option').nth(1).textContent()
  await service.selectOption(choix!)
  await expect.poll(() => lignes.count()).toBeLessThanOrEqual(total)
  const noms = grille.getByRole('columnheader', { name: 'Noms' })
  await noms.getByRole('button').click()
  await expect(noms).toHaveAttribute('aria-sort', 'ascending')
  await page.screenshot({ path: 'test-results/saisie-grille-filtree.png' })
  // Retour en haut à gauche : écran précédent.
  await page.getByRole('button', { name: 'Retour : Employés concernés' }).click()
  await expect(page.getByRole('heading', { name: /^EMPLOYÉS CONCERNÉS/ })).toBeVisible()
})
