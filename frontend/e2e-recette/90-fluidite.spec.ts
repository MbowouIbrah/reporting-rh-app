import { expect, type Page, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { ADMIN, choisirPeriode, connecter } from './outils'

// Mesure de fluidité (docs/etude-fluidite.md) : ne tourne que si MESURE=1, sur la version compilée (E2E_PREVIEW=1).
// Pour chaque clic : délai jusqu'à la première image (Event Timing), temps jusqu'aux données, longues images
// (Long Animation Frames), nombre maximal d'animations simultanées. Résultat : test-results/fluidite-<cpu>.json.
test.skip(!process.env.MESURE, 'mesure à la demande (MESURE=1)')

const CPU = Number(process.env.MESURE_CPU || 1)

async function installer(page: Page) {
  await page.addInitScript(() => {
    const w = window as any
    w.__m = { evts: [], loaf: [], anims: 0 }
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as any[]) if (e.interactionId) w.__m.evts.push({ t: e.startTime, d: e.duration, nom: e.name })
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as any)
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as any[]) w.__m.loaf.push({
        t: e.startTime, d: e.duration, b: e.blockingDuration,
        // Répartition : scripts, mise en page forcée par les scripts, style et mise en page de l'image.
        js: e.scripts.reduce((s: number, x: any) => s + x.duration, 0),
        force: e.scripts.reduce((s: number, x: any) => s + x.forcedStyleAndLayoutDuration, 0),
        rendu: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
      })
    }).observe({ type: 'long-animation-frame', buffered: true } as any)
    setInterval(() => { w.__m.anims = Math.max(w.__m.anims, document.getAnimations().length) }, 50)
  })
}

interface Mesure { action: string; clic: number; donnees: number; loafs: number; loafMax: number; bloquant: number; anims: number; js: number; force: number; rendu: number; noeuds: number }
const mesures: Mesure[] = []

// MESURE_PROFIL=<texte> : profil processeur des actions dont le nom contient ce texte (test-results/profil-*.cpuprofile).
async function mesurer(page: Page, action: string, faire: () => Promise<void>, pret: () => Promise<void>) {
  const profil = process.env.MESURE_PROFIL && action.includes(process.env.MESURE_PROFIL)
  const cdp = profil ? await page.context().newCDPSession(page) : null
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start') }
  const t0 = await page.evaluate(() => { const w = window as any; w.__m.evts = []; w.__m.loaf = []; w.__m.anims = 0; return performance.now() })
  await faire()
  await pret()
  await page.waitForTimeout(400)
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop')
    writeFileSync(`test-results/profil-${action.replace(/[^a-z0-9]+/gi, '-')}.cpuprofile`, JSON.stringify(profile))
    await cdp.detach()
  }
  const r = await page.evaluate((t0) => {
    const w = window as any
    const evts = w.__m.evts.filter((e: any) => e.t >= t0 - 5 && ['click', 'pointerup', 'pointerdown', 'keydown'].includes(e.nom))
    const loaf = w.__m.loaf.filter((e: any) => e.t >= t0)
    return {
      clic: Math.max(0, ...evts.map((e: any) => e.d)),
      loafs: loaf.length,
      loafMax: Math.max(0, ...loaf.map((e: any) => e.d)),
      bloquant: loaf.reduce((s: number, e: any) => s + e.b, 0),
      anims: w.__m.anims,
      js: loaf.reduce((s: number, e: any) => s + e.js, 0),
      force: loaf.reduce((s: number, e: any) => s + e.force, 0),
      rendu: loaf.reduce((s: number, e: any) => s + e.rendu, 0),
      noeuds: document.querySelectorAll('*').length,
      fin: performance.now(),
    }
  }, t0)
  mesures.push({ action, clic: Math.round(r.clic), donnees: Math.round(r.fin - t0 - 400), loafs: r.loafs, loafMax: Math.round(r.loafMax), bloquant: Math.round(r.bloquant), anims: r.anims, js: Math.round(r.js), force: Math.round(r.force), rendu: Math.round(r.rendu), noeuds: r.noeuds })
}

const calme = (page: Page) => async () => {
  await page.waitForLoadState('networkidle')
  // Prêt quand plus rien n'attend dans la partie visible (les graphiques hors écran se montent plus tard).
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('[aria-busy="true"]')].filter((e) => {
    const r = e.getBoundingClientRect()
    return r.bottom > 0 && r.top < innerHeight && r.width > 0
  }).length), { timeout: 30_000 }).toBe(0)
}

test('fluidité des écrans de rapport', async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await installer(page)
  if (CPU > 1) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
  }
  await connecter(page, ADMIN)
  const nav = page.getByRole('navigation', { name: 'Rapports' })
  const aller = (nom: RegExp) => () => nav.getByRole('link', { name: nom }).click()
  const rapports = await nav.getByRole('link').allTextContents()
  await nav.getByRole('link', { name: /Admin/ }).click()
  const onglets = page.getByRole('navigation', { name: 'Administration' })
  await onglets.getByRole('link').first().waitFor()
  const admin = await onglets.getByRole('link').allTextContents()
  await page.goto('resume')
  await calme(page)()

  // Deux passages : 1re ouverture (code et données à charger), puis réouverture (déjà en mémoire).
  for (const passage of ['1re ouverture', 'réouverture']) {
    for (const nom of rapports.filter((n) => !/Admin/.test(n))) {
      await mesurer(page, `${passage} : ${nom}`, () => nav.getByRole('link', { name: nom, exact: true }).click(), calme(page))
    }
    for (const nom of admin) {
      if (!(await onglets.isVisible())) await nav.getByRole('link', { name: /Admin/ }).click()
      await mesurer(page, `${passage} : Admin / ${nom}`, () => onglets.getByRole('link', { name: nom, exact: true }).click(), calme(page))
    }
  }
  await aller(/Mensuel/)()
  await calme(page)()
  await mesurer(page, 'mensuel : changer la période', () => choisirPeriode(page, 'mars'), calme(page))
  await mesurer(page, 'mensuel : point du rail', () => page.locator('.rail-point').nth(2).click(), async () => { await page.waitForTimeout(800) })
  await aller(/Graphes/)()
  await calme(page)()
  await mesurer(page, 'graphes : point du rail', () => page.locator('.rail-point').nth(1).click(), calme(page))
  await mesurer(page, 'graphes : ouvrir le menu des groupes', () => page.locator('details.menu-groupes summary').first().click(), async () => { await page.waitForTimeout(300) })

  writeFileSync(`test-results/fluidite-cpu${CPU}.json`, JSON.stringify(mesures, null, 1))
  console.table(mesures)
})
