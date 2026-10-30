import { expect, type Page, test } from '@playwright/test'
import { ADMIN, connecter, lireJson } from './outils'

type Fiche = { id: number; matricule: string; nom: string; poste: string | null; type_contrat: string | null; activite: string | null; site: string | null; service: string | null; actif: boolean }
type Prepa = { salaries: { matricule: string; nom: string; saisi: boolean; attributs: Record<string, string | null> }[] }

const MATRICULE = 'FICHE01'
const NOM = 'Fiche Recette'
const NOM_2 = 'Fiche Recette Modifiée'

const salaries = (page: Page) => lireJson<Fiche[]>(page.request, 'salaries')
const trouver = async (page: Page, matricule: string) => (await salaries(page)).find((s) => s.matricule === matricule)
// Employés proposés pour septembre (mois sans saisie) : la liste dépend de la fiche seulement
const proposes = async (page: Page) => (await lireJson<Prepa>(page.request, 'donnees/preparation?annee=2026&mois=9')).salaries
const formulaire = (page: Page) => page.locator('form.admin-form')
const ligne = (page: Page, matricule: string) => page.getByRole('row', { name: new RegExp(`^${matricule}\\b`) })

async function ouvrirEmployes(page: Page) {
  await page.goto('admin/employes')
  await expect(page.getByRole('heading', { name: 'ADMINISTRATION DES EMPLOYÉS' })).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
}

test.describe.serial('gestion des employés', () => {
  test.beforeEach(async ({ page }) => {
    await connecter(page, ADMIN)
  })

  test('liste : effectif affiché, recherche par matricule et par nom sans accent', async ({ page }) => {
    const tous = await salaries(page)
    await ouvrirEmployes(page)
    await expect(page.getByText(new RegExp(`^${tous.length} employés?$`))).toBeVisible()

    const un = tous.find((s) => s.matricule === 'EMP015')!
    await page.getByRole('searchbox').fill('emp015')
    await expect(page.getByText(/^1 employé$/)).toBeVisible()
    await expect(ligne(page, 'EMP015')).toContainText(un.nom)

    await page.getByRole('searchbox').fill('zzz-inconnu')
    await expect(page.getByText('Aucun employé ne correspond à la recherche')).toBeVisible()
    await page.getByRole('button', { name: 'Effacer la recherche' }).click()
    await expect(page.getByText(new RegExp(`^${tous.length} employés?$`))).toBeVisible()
  })

  test('création : champs obligatoires et matricule déjà utilisé refusés, rien n’est créé', async ({ page }) => {
    const avant = (await salaries(page)).length
    await ouvrirEmployes(page)
    await page.getByRole('button', { name: 'Nouvel employé' }).click()
    await expect(formulaire(page)).toBeVisible()

    await formulaire(page).getByRole('button', { name: 'Créer l’employé' }).click()
    await expect(page.getByText('Matricule obligatoire')).toBeVisible()
    await expect(page.getByText('Nom obligatoire')).toBeVisible()

    // Matricule existant, même écrit autrement (casse, espaces)
    await formulaire(page).getByLabel('Matricule').fill('  emp015 ')
    await formulaire(page).getByLabel('Nom', { exact: true }).fill('Doublon')
    await formulaire(page).getByRole('button', { name: 'Créer l’employé' }).click()
    await expect(formulaire(page).getByRole('alert')).toContainText('Matricule déjà existant')

    await formulaire(page).getByRole('button', { name: 'Annuler' }).click()
    await expect(formulaire(page)).toHaveCount(0)
    expect((await salaries(page)).length).toBe(avant)
    expect(await trouver(page, 'EMP015')).toMatchObject({ matricule: 'EMP015' })
    expect((await salaries(page)).filter((s) => s.nom === 'Doublon')).toHaveLength(0)

    // Même refus côté serveur, plus une valeur de liste inconnue
    const post = (data: object) => page.request.post('api/v1/salaries', { data })
    expect((await post({ matricule: 'emp015', nom: 'Doublon' })).status()).toBe(409)
    expect((await post({ matricule: '  ', nom: 'Sans matricule' })).status()).toBe(422)
    expect((await post({ matricule: MATRICULE, nom: '' })).status()).toBe(422)
    const inconnu = await post({ matricule: MATRICULE, nom: NOM, service: 'Service inexistant' })
    expect(inconnu.status()).toBe(422)
    expect((await inconnu.json()).detail).toContain('inconnu')
    expect(await trouver(page, MATRICULE)).toBeUndefined()
  })

  test('création : la fiche apparaît dans la liste et dans le choix des employés d’un mois', async ({ page }) => {
    await ouvrirEmployes(page)
    await page.getByRole('button', { name: 'Nouvel employé' }).click()
    const f = formulaire(page)
    await f.getByLabel('Matricule').fill(MATRICULE)
    await f.getByLabel('Nom', { exact: true }).fill(NOM)
    await f.getByLabel('Poste').selectOption({ index: 1 })
    await f.getByLabel('Type de contrat').selectOption({ index: 1 })
    await f.getByLabel('Activité').selectOption({ index: 1 })
    await f.getByLabel('Site').selectOption({ label: 'Douala' })
    await f.getByLabel('Service').selectOption({ label: 'Commerce VN' })
    await expect(f.getByLabel('Employé actif')).toBeChecked()
    await f.getByRole('button', { name: 'Créer l’employé' }).click()
    await expect(f).toHaveCount(0)

    const fiche = await trouver(page, MATRICULE)
    expect(fiche).toMatchObject({ nom: NOM, site: 'Douala', service: 'Commerce VN', actif: true })
    expect(fiche!.poste).not.toBeNull()
    expect(fiche!.type_contrat).not.toBeNull()
    expect(fiche!.activite).not.toBeNull()
    const rang = ligne(page, MATRICULE)
    await expect(rang).toContainText(NOM)
    for (const v of [fiche!.poste, fiche!.type_contrat, fiche!.activite, 'Douala', 'Commerce VN', 'Actif']) await expect(rang).toContainText(v!)

    // Journal d'audit
    const audit = await lireJson<{ action: string; entite_id: string; apres: { matricule: string } | null }[]>(page.request, 'audit')
    expect(audit.some((a) => a.action === 'creation_salarie' && a.entite_id === String(fiche!.id) && a.apres?.matricule === MATRICULE)).toBe(true)

    // Effet : l'employé est proposé pour le mois à saisir, avec ses attributs
    const prop = (await proposes(page)).find((s) => s.matricule === MATRICULE)
    expect(prop).toMatchObject({ nom: NOM, saisi: false })
    expect(prop!.attributs).toMatchObject({ service: 'Commerce VN', site: 'Douala' })

    await page.goto('admin/saisie')
    await page.getByRole('combobox', { name: 'Année', exact: true }).selectOption('2026')
    await page.getByRole('combobox', { name: 'Mois', exact: true }).selectOption({ label: 'Septembre' })
    await page.getByRole('button', { name: 'Étape 1 : choisir les employés de Septembre 2026 →' }).click()
    await page.getByRole('searchbox').fill(MATRICULE)
    await expect(page.getByRole('region', { name: 'Employés' })).toContainText(NOM)
  })

  test('modification : le matricule est figé, nom et service changent partout', async ({ page }) => {
    const avant = (await trouver(page, MATRICULE))!
    await ouvrirEmployes(page)
    await page.getByRole('button', { name: `Modifier ${NOM}` }).click()
    const f = formulaire(page)
    await expect(f.getByLabel('Matricule')).toBeDisabled()
    await expect(f.getByLabel('Matricule')).toHaveValue(MATRICULE)

    // Nom effacé : refusé
    await f.getByLabel('Nom', { exact: true }).fill('')
    await f.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Nom obligatoire')).toBeVisible()
    expect((await trouver(page, MATRICULE))!.nom).toBe(NOM)

    await f.getByLabel('Nom', { exact: true }).fill(NOM_2)
    await f.getByLabel('Service').selectOption({ label: 'Pneumatique' })
    await f.getByLabel('Poste').selectOption({ label: 'Non renseigné' })
    await f.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(f).toHaveCount(0)

    const apres = (await trouver(page, MATRICULE))!
    expect(apres).toMatchObject({ id: avant.id, nom: NOM_2, service: 'Pneumatique', poste: null, site: 'Douala', actif: true })
    const rang = ligne(page, MATRICULE)
    await expect(rang).toContainText(NOM_2)
    await expect(rang).toContainText('Pneumatique')

    const audit = await lireJson<{ action: string; entite_id: string; avant: Fiche; apres: Fiche }[]>(page.request, 'audit')
    const modif = audit.find((a) => a.action === 'modification_salarie' && a.entite_id === String(avant.id))
    expect(modif?.avant).toMatchObject({ nom: NOM, service: 'Commerce VN' })
    expect(modif?.apres).toMatchObject({ nom: NOM_2, service: 'Pneumatique' })

    const prop = (await proposes(page)).find((s) => s.matricule === MATRICULE)
    expect(prop).toMatchObject({ nom: NOM_2 })
    expect(prop!.attributs.service).toBe('Pneumatique')

    // Modification d'une fiche qui n'existe pas : refus
    const rep = await page.request.put('api/v1/salaries/999999', { data: { matricule: 'X', nom: 'X' } })
    expect(rep.status()).toBe(404)
  })

  test('annuler une modification ne change rien', async ({ page }) => {
    await ouvrirEmployes(page)
    await page.getByRole('button', { name: `Modifier ${NOM_2}` }).click()
    await formulaire(page).getByLabel('Nom', { exact: true }).fill('Ne doit pas être gardé')
    await formulaire(page).getByRole('button', { name: 'Annuler' }).click()
    await expect(formulaire(page)).toHaveCount(0)
    await expect(ligne(page, MATRICULE)).toContainText(NOM_2)
    expect((await trouver(page, MATRICULE))!.nom).toBe(NOM_2)
  })

  test('désactivation : statut inactif, retiré des employés proposés, puis réactivation', async ({ page }) => {
    await ouvrirEmployes(page)
    await page.getByRole('button', { name: `Désactiver ${NOM_2}` }).click()
    await expect(ligne(page, MATRICULE)).toContainText('Inactif')
    expect((await trouver(page, MATRICULE))!.actif).toBe(false)
    expect((await proposes(page)).some((s) => s.matricule === MATRICULE)).toBe(false)

    await page.getByRole('button', { name: `Réactiver ${NOM_2}` }).click()
    await expect(ligne(page, MATRICULE)).toContainText('Actif')
    expect((await trouver(page, MATRICULE))!.actif).toBe(true)
    expect((await proposes(page)).some((s) => s.matricule === MATRICULE)).toBe(true)

    // Laissé inactif : il ne gêne pas les saisies des autres parcours
    await page.getByRole('button', { name: `Désactiver ${NOM_2}` }).click()
    await expect(ligne(page, MATRICULE)).toContainText('Inactif')
  })
})
