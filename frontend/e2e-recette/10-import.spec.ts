import { expect, type Page, test } from '@playwright/test'
import { ADMIN, choisirPeriode, connecter, corrigerCellule, deplier, fichiers, importer, lireJson, ouvrirVolet, reinitialiserFiltres } from './outils'

// Import de juillet 2026 (avec erreurs) puis d'août 2026 (propre), dans l'ordre : l'état se transmet d'un test à l'autre.
test.describe.serial('import de fichiers', () => {
  let f: ReturnType<typeof fichiers>
  test.beforeAll(() => { f = fichiers() })

  // Les deux employés dont le site et le service ont changé en juillet : changement confirmé
  async function confirmerChangements(page: Page) {
    await ouvrirVolet(page, /Changements d’affectation/)
    for (const mat of [f.manifeste.cibles.site_inconnu, f.manifeste.cibles.service_faute]) {
      await page.getByRole('row', { name: new RegExp(`Détail de la ligne [0-9]+ ${mat}`) }).getByRole('button').first().click()
      await page.getByLabel('Mutation ou erreur ?').selectOption({ label: 'Changement à partir de ce mois' })
    }
  }

  test('juillet : fichier refusé, erreurs listées, rapport téléchargeable, enregistrement impossible', async ({ page }) => {
    await connecter(page, ADMIN)
    await importer(page, f.juilletErreurs)
    await expect(page.getByRole('heading', { name: /FICHIER REFUSÉ — juillet_2026_erreurs\.xlsx/ })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('Fichier refusé : 6 erreurs à corriger')

    const erreurs = page.getByRole('region', { name: 'Erreurs du fichier' })
    await expect(erreurs.getByRole('button', { name: /Erreurs à corriger/ })).toContainText('6')
    for (const attendu of ['douze mille', 'Bonamoussadi', 'Pneumatiques', 'Juilet', f.manifeste.cibles.doublon]) {
      await expect(erreurs.getByRole('row', { name: new RegExp(attendu) }).first()).toBeVisible()
    }

    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: /Télécharger le rapport d.erreurs/ }).click(),
    ])
    expect(dl.suggestedFilename()).toMatch(/\.xlsx$/)
    const chemin = await dl.path()
    const { readFileSync } = await import('node:fs')
    const octets = readFileSync(chemin)
    expect(octets.length).toBeGreaterThan(1000)
    expect(octets.subarray(0, 2).toString()).toBe('PK')

    // Rien n'est enregistré : le lot reste refusé et le serveur refuse de le valider.
    const lots = await lireJson<{ id: number; statut: string; fichier_nom: string }[]>(page.request, 'imports')
    const lot = lots.find((l) => l.fichier_nom === 'juillet_2026_erreurs.xlsx' && l.statut !== 'annule')!
    expect(lot.statut).toBe('rejete')
    const valider = await page.request.post(`api/v1/imports/${lot.id}/valider`, { data: {} })
    expect(valider.status()).toBe(409)
    const periodes = await lireJson<{ annee: number; mois: number }[]>(page.request, 'rapports/periodes')
    expect(periodes.some((p) => p.annee === 2026 && p.mois === 7)).toBe(false)
  })

  test('juillet : correction des erreurs dans l’écran, confirmation des points, enregistrement', async ({ page }) => {
    test.slow() // toutes les lignes vérifiées puis enregistrées : dépasse le délai par défaut
    const c = f.manifeste.cibles
    await connecter(page, ADMIN)
    await importer(page, f.juilletErreurs)
    await expect(page.getByRole('alert')).toContainText('6 erreurs à corriger')

    // Montant illisible : cellule à saisir
    await deplier(page, 6)
    await corrigerCellule(page, 6, 'Crédit téléphonique', '12000')
    // Site inconnu : ajouté à la liste, avec son type
    await deplier(page, 9)
    await page.getByLabel(/Site « Bonamoussadi » absent de la liste des sites/).selectOption({ label: 'Ajouter « Bonamoussadi » à la liste des sites' })
    await page.getByLabel('Type du nouveau site').selectOption({ label: 'Agence' })
    // Service mal orthographié : remplacé par le service proche
    await deplier(page, 12)
    await page.getByLabel(/Service « Pneumatiques » absent de la liste des services/).selectOption({ label: 'Remplacer par « Pneumatique »' })
    // Ligne sans matricule ni nom : on les retape
    await deplier(page, 15)
    await corrigerCellule(page, 15, 'MATRICULE', c.sans_matricule)
    await corrigerCellule(page, 15, 'Noms', f.manifeste.noms.sans_matricule)
    // Doublon : on garde la première ligne
    await deplier(page, 18, false)
    await page.getByLabel('Employé sur plusieurs lignes du même mois : quelle ligne garder ?').selectOption({ label: 'Garder la ligne 18, supprimer la ligne 19' })
    // Mois mal écrit
    await deplier(page, 25)
    await corrigerCellule(page, 25, 'MOIS', 'Juillet')

    // Les sept corrections sont bien prises en compte avant d'enregistrer
    await expect(page.getByRole('button', { name: /^Annuler \((?:[7-9]|\d\d) modifications\)$/ })).toBeVisible()
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()

    // Plus d'erreur bloquante : restent les points à confirmer
    await expect(page.getByRole('heading', { name: /POINTS À CONFIRMER/ })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('4 points à confirmer')
    // Site et service ont changé par rapport à juin : changement d'affectation confirmé
    await ouvrirVolet(page, /Changements d’affectation/)
    for (const ligne of [9, 12]) {
      await deplier(page, ligne)
      await page.getByLabel('Mutation ou erreur ?').selectOption({ label: 'Changement à partir de ce mois' })
    }
    await ouvrirVolet(page, /Montants et listes de valeurs/)
    await deplier(page, 22)
    await page.getByLabel('Mois différent du reste du fichier : que faire ?').selectOption({ label: 'Corriger en Juillet, comme les autres lignes' })
    await deplier(page, 28)
    await page.getByLabel('Montant négatif : régularisation ou erreur de signe ?').selectOption({ label: 'Régularisation confirmée' })
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()

    // Vérification avant enregistrement : toutes les lignes de juin à ajouter, aucun départ, aucun nouvel employé
    await expect(page.getByRole('heading', { name: /VÉRIFICATION AVANT ENREGISTREMENT — juillet_2026_erreurs\.xlsx/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: `Lignes (${f.manifeste.lignes_base})` })).toBeVisible()
    await expect(page.getByRole('heading', { name: `Employés (${f.manifeste.lignes_base})` })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Contrôles' })).toContainText('0 erreur bloquante')
    await page.getByRole('button', { name: `Enregistrer ${f.manifeste.lignes_base} lignes` }).click()

    await expect(page).toHaveURL(/admin$/, { timeout: 30_000 })
    await expect(page.getByText(`Enregistré : ${f.manifeste.lignes_base} lignes`)).toBeVisible({ timeout: 30_000 })
  })

  test('juillet : visible dans le rapport mensuel, valeurs corrigées retrouvées', async ({ page }) => {
    await connecter(page, ADMIN)
    const m = await lireJson(page.request, 'rapports/mensuel?annee=2026&mois=7')
    expect(m.synthese.effectif.fin).toBe(f.manifeste.lignes_base)
    expect(m.controles.filter((x: { bloquant: boolean }) => x.bloquant)).toEqual([])

    await page.goto('mensuel')
    await reinitialiserFiltres(page)
    await choisirPeriode(page, 'Juillet')
    await expect(page.getByRole('heading', { name: '1. Reporting global' })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)

    // Chaque correction retrouvée dans la feuille de données de juillet
    const sites = await lireJson<{ valeurs: { libelle: string; type_site: string }[] }>(page.request, 'referentiels/site')
    expect(sites.valeurs.find((v) => v.libelle === 'Bonamoussadi')?.type_site).toBe('agence')
    const jul = await lireJson<{ lignes: { matricule: string; nom: string; site: string; service: string; montants: Record<string, string> }[] }>(page.request, 'donnees?annee=2026&mois=7')
    const ligne = (mat: string) => jul.lignes.filter((l) => l.matricule === mat)
    const c = f.manifeste.cibles
    expect(jul.lignes).toHaveLength(f.manifeste.lignes_base)
    expect(Number(ligne(c.non_numerique)[0].montants['Crédit téléphonique'])).toBe(12000)
    expect(ligne(c.site_inconnu)[0].site).toBe('Bonamoussadi')
    expect(ligne(c.service_faute)[0].service).toBe('Pneumatique')
    expect(ligne(c.sans_matricule)[0].nom).toBe(f.manifeste.noms.sans_matricule)
    expect(ligne(c.doublon)).toHaveLength(1)
    expect(ligne(c.mois_isole)).toHaveLength(1)
    expect(ligne(c.mois_faux)).toHaveLength(1)
    expect(Number(ligne(c.negatif)[0].montants['Frais de mission'])).toBe(-2500)
  })

  test('août : fichier propre, aperçu des départs et du nouvel employé, enregistrement', async ({ page }) => {
    test.slow() // enregistrement d'un mois complet : dépasse le délai par défaut
    await connecter(page, ADMIN)
    await importer(page, f.aout)
    // Le site et le service créés en juillet pour deux employés s'y retrouvent : c'est un changement par rapport à juin
    await expect(page.getByRole('heading', { name: /POINTS À CONFIRMER — aout_2026\.xlsx/ })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('2 points à confirmer')
    await confirmerChangements(page)
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await expect(page.getByRole('heading', { name: /VÉRIFICATION AVANT ENREGISTREMENT — aout_2026\.xlsx/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: `Lignes (${f.manifeste.lignes_aout})` })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Employés' })).toContainText('1 nouvel employé')
    await expect(page.getByRole('region', { name: 'Employés' })).toContainText('2 oublis ou départs')
    await expect(page.getByRole('region', { name: 'Contrôles' })).toContainText('0 erreur bloquante')
    await page.getByRole('button', { name: /Oublis ou départs/ }).click()
    for (const m of f.manifeste.departs_aout) await expect(page.getByRole('region', { name: "Détail de l'aperçu" })).toContainText(m)
    await page.getByRole('button', { name: /Nouveaux employés/ }).click()
    await expect(page.getByRole('region', { name: "Détail de l'aperçu" })).toContainText(f.manifeste.nouveau.matricule)

    await page.getByRole('button', { name: `Enregistrer ${f.manifeste.lignes_aout} lignes` }).click()
    await expect(page).toHaveURL(/admin$/, { timeout: 30_000 })
    await expect(page.getByText(`Enregistré : ${f.manifeste.lignes_aout} lignes`)).toBeVisible({ timeout: 30_000 })

    const m = await lireJson(page.request, 'rapports/mensuel?annee=2026&mois=8')
    expect(m.synthese.effectif.fin).toBe(f.manifeste.lignes_aout)
    await page.goto('mensuel')
    await reinitialiserFiltres(page)
    await choisirPeriode(page, 'Août')
    await expect(page.getByRole('heading', { name: '1. Reporting global' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('août : le même fichier réimporté est refusé, rien ne change', async ({ page }) => {
    await connecter(page, ADMIN)
    await importer(page, f.aout)
    await expect(page.getByRole('alert')).toContainText('Ce fichier a déjà été importé et enregistré.')
    const m = await lireJson(page.request, 'rapports/mensuel?annee=2026&mois=8')
    expect(m.synthese.effectif.fin).toBe(f.manifeste.lignes_aout)
  })

  test('août : un fichier révisé remplace le mois après choix ligne par ligne', async ({ page }) => {
    test.slow() // enregistrement d'un mois complet : dépasse le délai par défaut
    const rev = f.manifeste.revisions_aout
    await connecter(page, ADMIN)
    await importer(page, f.aoutRevise)
    await expect(page.getByRole('heading', { name: /POINTS À CONFIRMER — aout_2026_revise\.xlsx/ })).toBeVisible()
    await confirmerChangements(page)
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await expect(page.getByRole('heading', { name: /VÉRIFICATION AVANT ENREGISTREMENT — aout_2026_revise\.xlsx/ })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Lignes' })).toContainText(`${rev.length} à mettre à jour`)
    await ouvrirVolet(page, /Lignes à mettre à jour/)
    const detail = page.getByRole('region', { name: "Détail de l'aperçu" })
    for (const r of rev) {
      const ligne = detail.getByRole('row', { name: new RegExp(r.matricule) })
      await expect(ligne).toContainText('Frais de mission')
    }

    // Le premier employé garde ses montants enregistrés, les autres sont remplacés
    await detail.getByRole('row', { name: new RegExp(rev[0].matricule) }).getByLabel('Garder').check()
    await page.getByRole('button', { name: `Enregistrer ${rev.length - 1} lignes` }).click()
    await expect(page).toHaveURL(/admin$/, { timeout: 30_000 })
    await expect(page.getByText(`Enregistré : ${rev.length - 1} lignes`)).toBeVisible({ timeout: 30_000 })

    const aout = await lireJson<{ lignes: { matricule: string; montants: Record<string, string> }[] }>(page.request, 'donnees?annee=2026&mois=8')
    const frais = (mat: string) => Number(aout.lignes.find((l) => l.matricule === mat)!.montants['Frais de mission'] ?? 0)
    expect(frais(rev[0].matricule)).toBe(rev[0].avant)
    for (const r of rev.slice(1)) expect(frais(r.matricule)).toBe(r.apres)
  })
})
