// Captures par rôle et par page. Usage: node e2e/captures.mjs <avant|apres>
// Serveurs attendus: API :8000 et front :5173 (base de recette e2e_seed.py).
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const dossier = `captures/${process.argv[2] || 'avant'}`
const PW = '<mot-de-passe-test>'
const BASE = `http://localhost:${process.env.E2E_WEB_PORT || 5173}/reporting-rh/`
const roles = [
  ['drh', 'drh@exemple.invalid', ['resume', 'mensuel', 'annuel', 'graphes', 'individuel?matricule=E1']],
  ['perimetre', 'dps.equipment@exemple.invalid', ['resume', 'mensuel']],
]
const tailles = [[1440, 900], [1024, 768], [390, 844]]

mkdirSync(dossier, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined })
for (const [nom, email, pages] of roles) {
  for (const [w, h] of tailles) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    await page.goto(`${BASE}login`)
    await page.getByLabel('Adresse e-mail').fill(email)
    await page.getByLabel('Mot de passe').fill(PW)
    if (nom === 'drh' && w === 1440) await page.screenshot({ path: `${dossier}/connexion-${w}.png` })
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await page.waitForURL(/resume/)
    for (const p of pages) {
      await page.goto(`${BASE}${p}`)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${dossier}/${nom}-${p.split('?')[0]}-${w}.png`, fullPage: true })
    }
    await ctx.close()
  }
}
await browser.close()
console.log('captures ok ->', dossier)
