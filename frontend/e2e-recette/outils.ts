import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type APIRequestContext, type Page, type Request, type Route } from '@playwright/test'

// Mot de passe des comptes de recette : début de l'adresse + « <suffixe-retire> »
export const mdpDe = (email: string) => `${email.toLowerCase().split('@')[0]}<suffixe-retire>`
export const ADMIN = 'admin@exemple.invalid'

export async function connecter(page: Page, email: string, mdp = mdpDe(email)) {
  await page.goto('login')
  await page.getByRole('group', { name: 'Connexion' }).getByLabel('Adresse e-mail').fill(email)
  await page.getByRole('group', { name: 'Connexion' }).getByLabel('Mot de passe', { exact: true }).fill(mdp)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  const menu = page.getByRole('navigation', { name: 'Rapports' })
  const changement = page.getByRole('heading', { name: 'Changez votre mot de passe' })
  await expect(menu.or(changement)).toBeVisible()
  if (await changement.isVisible()) {
    await leverProvisoire(page, mdp)
    await page.goto('resume')
  }
  await expect(menu).toBeVisible()
}

// Compte créé par un admin : lève l'obligation en gardant le mot de passe attendu par les parcours.
async function leverProvisoire(page: Page, mdp: string) {
  const etape = `${mdp}-etape`
  for (const [actuel, nouveau] of [[mdp, etape], [etape, mdp]]) {
    const r = await page.request.post('api/v1/auth/changer-mot-de-passe', { data: { actuel, nouveau } })
    expect(r.status()).toBe(200)
  }
}

export async function deconnecter(page: Page) {
  await page.getByRole('button', { name: 'Profil' }).click()
  await page.getByRole('button', { name: 'Déconnexion' }).click()
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible()
}

const PY = process.platform === 'win32' ? '..\\backend\\.venv\\Scripts\\python' : '../backend/.venv/bin/python'
const DOSSIER = resolve('test-results', 'fichiers-recette')

export interface Manifeste {
  lignes_base: number
  cibles: Record<string, string>
  noms: Record<string, string>
  departs_aout: string[]
  nouveau: { matricule: string; nom: string }
  lignes_aout: number
  revisions_aout: { matricule: string; avant: number; apres: number }[]
}

/** Fichiers d'import de la recette, régénérés à l'identique par le script de tools/recette. */
export function fichiers() {
  execFileSync(PY, ['-W', 'ignore', '../tools/recette/fichier_erreurs.py', DOSSIER], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  const manifeste = JSON.parse(readFileSync(resolve(DOSSIER, 'manifeste.json'), 'utf-8')) as Manifeste
  const chemin = (nom: string) => {
    const p = resolve(DOSSIER, nom)
    if (!existsSync(p)) throw new Error(`Fichier absent : ${p}`)
    return p
  }
  return {
    manifeste,
    juilletErreurs: chemin('juillet_2026_erreurs.xlsx'),
    aout: chemin('aout_2026.xlsx'),
    aoutRevise: chemin('aout_2026_revise.xlsx'),
  }
}

const api = (chemin: string) => `api/v1/${chemin}`

export async function lireJson<T = any>(r: APIRequestContext, chemin: string): Promise<T> {
  const rep = await r.get(api(chemin))
  expect(rep.status(), chemin).toBe(200)
  return (await rep.json()) as T
}

/** Ouvre « Renseigner des données » depuis l'administration. */
export async function ouvrirSaisie(page: Page) {
  await page.goto('admin')
  await page.getByRole('link', { name: 'Renseigner des données' }).click()
  await expect(page).toHaveURL(/admin\/saisie$/)
  await expect(page.getByRole('heading', { name: 'RENSEIGNER DES DONNÉES' })).toBeVisible()
}

/** Cellule d'une ligne du fichier (tableau « Ligne N du fichier »), repérée par le titre de sa colonne. */
export async function cellule(page: Page, ligne: number, colonne: string) {
  const tableau = page.getByRole('table', { name: `Ligne ${ligne} du fichier` })
  await expect(tableau).toBeVisible()
  const rang = await tableau.getByRole('columnheader', { name: colonne, exact: true }).evaluate((th) => (th as HTMLTableCellElement).cellIndex)
  return tableau.locator('tbody tr').first().locator('td').nth(rang)
}

/** Corrige une cellule du fichier directement dans l'écran. */
export async function corrigerCellule(page: Page, ligne: number, colonne: string, valeur: string) {
  await (await cellule(page, ligne, colonne)).click()
  const champ = page.getByRole('textbox', { name: `${colonne}, ligne ${ligne}` }).or(page.getByRole('combobox', { name: `${colonne}, ligne ${ligne}` }))
  await champ.fill(valeur)
  await champ.press('Enter')
  await expect(champ).toHaveCount(0)
}

export async function deplier(page: Page, ligne: number, avecTableau = true) {
  const bouton = page.getByRole('button', { name: `Détail de la ligne ${ligne}`, exact: true }).first()
  if ((await bouton.getAttribute('aria-expanded')) !== 'true') await bouton.click()
  if (avecTableau) await expect(page.getByRole('table', { name: `Ligne ${ligne} du fichier` })).toBeVisible()
}

/** Ouvre un volet de l'écran d'import (replié par défaut, sauf « Erreurs à corriger »). */
export async function ouvrirVolet(page: Page, titre: RegExp | string) {
  const volet = page.getByRole('button', { name: titre }).first()
  if ((await volet.getAttribute('aria-expanded')) !== 'true') await volet.click()
  await expect(volet).toHaveAttribute('aria-expanded', 'true')
}

/** Les filtres sont partagés entre pages : on repart de zéro (le bouton est grisé si rien n'est filtré). */
export async function reinitialiserFiltres(page: Page) {
  const bouton = page.getByRole('button', { name: 'Réinitialiser les filtres' })
  await expect(bouton).toBeVisible()
  if (await bouton.isEnabled()) await bouton.click()
}

/**
 * Envoie un fichier depuis « Renseigner des données ». En développement, React monte l'écran deux fois et
 * envoie le fichier deux fois : l'écran affiche la dernière réponse, mais si le serveur a traité les deux
 * envois dans l'ordre inverse, ce lot est déjà abandonné. On recommence alors, pour ne tester que le vrai parcours.
 */
export async function importer(page: Page, chemin: string) {
  const trace: string[] = []
  for (let essai = 0; essai < 4; essai++) {
    const envois: Request[] = []
    const suivre = (r: Request) => { if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/imports')) envois.push(r) }
    page.on('request', suivre)
    // Les deux envois du mode développement sont traités l'un après l'autre : le dernier envoyé est aussi le dernier créé
    let precedent: Promise<void> = Promise.resolve()
    const enFile = async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const attente = precedent
      let fin!: () => void
      precedent = new Promise<void>((ok) => { fin = ok })
      await attente
      try {
        await route.continue()
        await route.request().response()
      } finally {
        fin()
      }
    }
    await page.route(/\/imports$/, enFile)
    try {
      await ouvrirSaisie(page)
      await page.locator('input[type=file]').first().setInputFiles(chemin)
      await expect(page.getByRole('heading', { level: 2, name: /FICHIER REFUSÉ|POINTS À CONFIRMER|VÉRIFICATION AVANT ENREGISTREMENT/ }).or(page.getByRole('alert')).first()).toBeVisible()
      const reponse = await envois.at(-1)!.response()
      if (!reponse?.ok()) return
      const { id } = await reponse.json()
      const lots = await lireJson<{ id: number; statut: string }[]>(page.request, 'imports')
      trace.push(`envois=${envois.length} affiche=${id} lots=${JSON.stringify(lots.map((l) => [l.id, l.statut]))}`)
      if (lots.find((l) => l.id === id)?.statut !== 'annule') return
    } finally {
      page.off('request', suivre)
      await page.unroute(/\/imports$/, enFile)
    }
  }
  throw new Error('Le fichier a été abandonné à chaque envoi ' + trace.join(' ; '))
}

/** Sélecteur « Période » des rapports (liste mois + année, pas un <select>). */
export async function choisirPeriode(page: Page, mois: string, annee = 2026) {
  await page.getByRole('combobox', { name: 'Période' }).click()
  await page.getByRole('option').filter({ hasText: mois }).filter({ hasText: String(annee) }).click()
}
