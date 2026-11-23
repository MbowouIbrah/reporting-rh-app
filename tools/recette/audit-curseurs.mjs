/**
 * Contrôle des curseurs (R7, réunion du 17/11), en lecture seule.
 *
 * Se connecte, ouvre chaque écran du menu et relève, pour chaque élément visible, le curseur calculé :
 * *  - texte fixe avec le curseur de saisie (I), ou le curseur « auto » du navigateur qui affiche ce I sur le texte ;
 *  - commande cliquable sans la main ;
 *  - commande désactivée avec la main ;
 *  - main sur un élément qui n'est pas une commande (à vérifier à l'œil : clic géré en JS ou faux signal).
 *
 *   cd frontend && node ../tools/recette/audit-curseurs.mjs
 *   cd frontend && node ../tools/recette/audit-curseurs.mjs --avec-regles   (injecte styles/interactions.css)
 *
 * Variables : AUDIT_URL (défaut http://localhost:8090), AUDIT_COMPTES (comptes.local.csv du site visé),
 * AUDIT_SORTIE (défaut C:/tmp/audit-curseurs : rapport.md).
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = createRequire(pathToFileURL(resolve('package.json')))('@playwright/test')

const AVEC_REGLES = process.argv.includes('--avec-regles')
const URL = (process.env.AUDIT_URL || 'http://localhost:8090').replace(/\/$/, '')
const COMPTES = process.env.AUDIT_COMPTES || resolve('..', 'tools', 'recette', 'comptes.local.csv')
const SORTIE = process.env.AUDIT_SORTIE || 'C:/tmp/audit-curseurs'
const REGLES = resolve('src', 'styles', 'interactions.css')
const ECRANS = ['/resume', '/graphes', '/charges', '/individuel', '/admin/donnees', '/admin/employes',
  '/admin/referentiels', '/admin/utilisateurs', '/admin/colonnes', '/admin/correspondance', '/admin/saisie']
const NAVIGATEURS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

function compte() {
  if (!existsSync(COMPTES)) throw new Error(`Comptes introuvables : ${COMPTES} (AUDIT_COMPTES)`)
  const [entete, ...lignes] = readFileSync(COMPTES, 'utf-8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const col = entete.split(';')
  const v = lignes.map((l) => l.split(';')).find((x) => x[col.indexOf('identifiant')] === 'admin')
  return { email: v[col.indexOf('email')], mdp: v[col.indexOf('mot_de_passe')] }
}

/** Exécuté dans la page : relève les écarts de curseur. */
function relever() {
  const COMMANDE = 'button, a[href], summary, select, label, input, textarea, [role=button], [role=tab], [role=link], [role=menuitem], [role=option], [role=checkbox], [role=radio], [role=switch], [contenteditable=true], [draggable=true], [tabindex]:not([tabindex="-1"])'
  const SAISIE = 'input:not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=file]):not([type=range]):not([type=color]):not([readonly]), textarea:not([readonly]), [contenteditable=true]'
  const nom = (e) => {
    const t = (e.getAttribute('aria-label') || e.innerText || e.getAttribute('title') || '').trim().replace(/\s+/g, ' ')
    const c = typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/).join('.')}` : ''
    return `${e.tagName.toLowerCase()}${c} « ${t.slice(0, 40)} »`
  }
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' }
  const ecarts = []
  for (const e of document.body.querySelectorAll('*')) {
    if (!visible(e) || e.closest('svg') && e.tagName.toLowerCase() !== 'svg') continue
    const cur = getComputedStyle(e).cursor
    const commande = e.closest(COMMANDE)
    const desactive = e.closest(':disabled, [aria-disabled=true]')
    const texteDirect = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if ((cur === 'text' || cur === 'auto') && !e.closest(SAISIE) && !e.closest('.modifiable, .en-saisie') && texteDirect)
      ecarts.push(['Texte fixe avec curseur de saisie', nom(e)])
    else if (e.matches('button, a[href], summary, select, [role=button], [role=tab], [role=menuitem], input[type=checkbox], input[type=radio]') && !desactive && !['pointer', 'help'].includes(cur))
      ecarts.push([`Commande sans la main (${cur})`, nom(e)])
    else if (e.matches(':disabled, [aria-disabled=true]') && cur === 'pointer')
      ecarts.push(['Commande désactivée avec la main', nom(e)])
    else if (cur === 'pointer' && !commande && !e.closest('tr.depliable, .saisie-liste tbody tr, [onclick]') && texteDirect && getComputedStyle(e.parentElement).cursor !== 'pointer')
      ecarts.push(['Main sur un élément non commande (à vérifier)', nom(e)])
  }
  return ecarts
}

const navigateur = NAVIGATEURS.find(existsSync)
const b = await chromium.launch({ executablePath: navigateur, headless: true })
const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
const injecter = async () => { if (AVEC_REGLES) await page.addStyleTag({ content: readFileSync(REGLES, 'utf-8') }) }

const c = compte()
await page.goto(`${URL}/login`)
await injecter()
const avant = await page.evaluate(relever)
await page.locator('input[type=email], input[name=email]').first().fill(c.email)
await page.locator('input[type=password]').first().fill(c.mdp)
await page.keyboard.press('Enter')
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 })

const resultats = [['/login', avant]]
for (const ecran of ECRANS) {
  await page.goto(`${URL}${ecran}`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(800)
  if (new globalThis.URL(page.url()).pathname !== ecran) continue
  await injecter()
  resultats.push([ecran, await page.evaluate(relever)])
}
await b.close()

mkdirSync(SORTIE, { recursive: true })
const lignes = [`# Audit des curseurs ${AVEC_REGLES ? '(avec interactions.css)' : '(site tel quel)'}`, '', `Site : ${URL}`, '']
let total = 0
for (const [ecran, ecarts] of resultats) {
  const uniques = [...new Map(ecarts.map((x) => [x.join(' | '), x])).values()]
  total += uniques.length
  lignes.push(`## ${ecran} (${uniques.length})`, '', ...uniques.map(([t, n]) => `- ${t} : ${n}`), '')
  console.log(`${ecran} : ${uniques.length} écart(s)`)
}
writeFileSync(`${SORTIE}/rapport${AVEC_REGLES ? '-avec-regles' : ''}.md`, lignes.join('\n'))
console.log(`Total : ${total} écart(s). Rapport : ${SORTIE}`)
