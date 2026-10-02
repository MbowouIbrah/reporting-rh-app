// Audit axe par rôle et par page. Usage: E2E_WEB_PORT=5180 node e2e/axe.mjs
import { chromium } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const PW = '<mot-de-passe-test>'
const BASE = `http://localhost:${process.env.E2E_WEB_PORT || 5173}/reporting-rh/`
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
let total = 0
async function audit(nom) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  for (const v of r.violations) {
    total++
    console.log(`${nom}: [${v.impact}] ${v.id} x${v.nodes.length} ${v.nodes[0].target.join(' ')}`)
  }
}
await page.goto(`${BASE}login`)
await audit('connexion')
await page.getByLabel('Adresse e-mail').fill('drh@exemple.invalid')
await page.getByLabel('Mot de passe').fill(PW)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.getByRole('navigation', { name: 'Rapports' }).waitFor()
for (const p of ['resume', 'mensuel', 'annuel', 'graphes', 'individuel?matricule=E1']) {
  await page.goto(`${BASE}${p}`)
  await audit(p.split('?')[0])
}
await page.goto(`${BASE}login`)
await page.getByLabel('Adresse e-mail').fill('admin@exemple.invalid')
await page.getByLabel('Mot de passe').fill(PW)
await page.getByRole('button', { name: 'Se connecter' }).click()
await page.getByRole('navigation', { name: 'Rapports' }).waitFor()
for (const p of ['periodes', 'utilisateurs', 'perimetres', 'referentiels', 'budgets', 'parametrage', 'journal']) {
  await page.goto(`${BASE}admin/${p}`)
  await audit(`admin/${p}`)
}
await browser.close()
console.log(total ? `${total} violation(s)` : 'axe: aucune violation')
