import { expect, type Page, test } from '@playwright/test'
import { ADMIN, connecter } from './outils'

/** Aucun cadre de tableau ne défile ni ne coupe son contenu ; seules les sections défilent. */
async function etat(page: Page) {
  return page.evaluate(() => {
    const corps = [...document.querySelectorAll<HTMLElement>('.snap-section .panneau-corps')]
    const sections = [...document.querySelectorAll<HTMLElement>('.snap-section')]
    return {
      cadresDefilants: corps.filter((c) => ['auto', 'scroll'].includes(getComputedStyle(c).overflowY)).length,
      cadresCoupes: corps.filter((c) => {
        const t = c.querySelector('table')
        return t && t.getBoundingClientRect().height > c.getBoundingClientRect().height + 1
      }).length,
      sectionsDefilables: sections.filter((s) => getComputedStyle(s).overflowY === 'auto').length,
      sections: sections.length,
      totauxFiges: [...document.querySelectorAll('.snap-section tbody.pied')].filter((b) => getComputedStyle(b).position === 'sticky').length,
      ligneMin: Math.min(...[...document.querySelectorAll('.snap-section tbody tr')].map((r) => r.getBoundingClientRect().height), 99),
      accrochage: getComputedStyle(document.querySelector('.snap-scroll')!).scrollSnapType,
    }
  })
}

for (const [w, h] of [[1440, 900], [1366, 640]]) {
  test(`défilement des sections ${w}×${h} : tableaux entiers, la section défile`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: w, height: h })
    await connecter(page, ADMIN)
    for (const ecran of ['mensuel', 'annuel', 'graphes']) {
      await page.goto(ecran)
      await expect.poll(() => page.locator('.snap-section').count(), { timeout: 20_000 }).toBeGreaterThan(1)
      await page.waitForLoadState('networkidle')
      const e = await etat(page)
      expect(e.cadresDefilants, ecran).toBe(0)
      expect(e.cadresCoupes, ecran).toBe(0)
      expect(e.sectionsDefilables, ecran).toBe(e.sections)
      expect(e.accrochage, ecran).toContain('mandatory')
      expect(e.totauxFiges, ecran).toBe(0)
      expect(e.ligneMin, ecran).toBeGreaterThanOrEqual(27.5)
      if (ecran === 'graphes') {
        // Titre du groupe visible sur la même ligne que le menu des groupes
        const menu = (await page.locator('.graphes-tete .menu-groupes').boundingBox())!
        const titre = (await page.locator('.graphes-tete-titre').boundingBox())!
        expect(Math.abs(menu.y + menu.height / 2 - (titre.y + titre.height / 2))).toBeLessThan(4)
        expect(titre.x).toBeGreaterThan(menu.x + menu.width)
        await expect(page.locator('.snap-section .graphes-groupe-titre').first()).toBeHidden()
        const premier = await page.locator('.graphes-tete-titre').textContent()
        await page.locator('.rail-point').nth(1).click()
        await expect(page.locator('.graphes-tete-titre')).not.toHaveText(premier!)
      }
      await page.screenshot({ path: `test-results/defilement-${ecran}-${w}x${h}.png` })
    }
  })
}

test('molette : la section haute défile d’abord, puis on passe à la suivante', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1366, height: 640 })
  await connecter(page, ADMIN)
  await page.goto('mensuel')
  await expect.poll(() => page.locator('.snap-section').count(), { timeout: 20_000 }).toBeGreaterThan(1)
  await page.waitForLoadState('networkidle')
  // Première section qui dépasse l'écran
  const i = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.snap-section')].findIndex((s) => s.scrollHeight > s.clientHeight + 1),
  )
  test.skip(i < 0, 'aucune section plus haute que l’écran à cette taille')
  const section = page.locator('.snap-section').nth(i)
  await section.evaluate((s) => s.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(400)
  // Le bouton du rail porte le titre de la section suivante, même au milieu d'une section
  await expect(page.locator('.rail-suite')).toHaveAttribute('aria-label', (await page.locator('.rail-point').nth(i + 1).getAttribute('aria-label'))!)
  const box = (await section.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 200)
  await expect.poll(() => section.evaluate((s) => s.scrollTop)).toBeGreaterThan(0)
  const avant = await page.locator('.rail-point').nth(i).getAttribute('aria-label')
  // Même geste qui arrive au bout de la section : on reste sur la section
  await section.evaluate((s) => { s.scrollTop = s.scrollHeight - s.clientHeight - 40 })
  await page.waitForTimeout(400)
  for (let k = 0; k < 8; k++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(40)
  }
  await page.waitForTimeout(600)
  await expect(page.locator('.rail-point.actif')).toHaveAttribute('aria-label', avant!)
  // Relâché puis nouveau geste : section suivante
  await page.mouse.wheel(0, 120)
  await expect.poll(() => page.locator('.rail-point.actif').getAttribute('aria-label')).not.toBe(avant)
  // La flèche du rail mène aussi à la suite
  const ici = await page.locator('.rail-point.actif').getAttribute('aria-label')
  await page.waitForTimeout(800)
  const cible = await page.locator('.rail-suite').getAttribute('aria-label')
  await page.locator('.rail-suite').click()
  await expect(page.locator('.rail-point.actif')).toHaveAttribute('aria-label', cible!)
  expect(cible).not.toBe(ici)
})

test('individuel : activité en colonnes du tableau, Mois et Total mensuel figés', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await connecter(page, ADMIN)
  await page.goto('individuel')
  await expect(page.locator('table.individuel')).toBeVisible({ timeout: 20_000 })
  await page.waitForLoadState('networkidle')
  await expect(page.locator('details', { hasText: 'Activité' })).toHaveCount(0)
  const act = page.locator('table.individuel thead th.activite')
  test.skip((await act.count()) === 0, 'pas d’activité dans cette base')
  await expect(act.first()).toHaveText('Nombre de ventes')
  // En-têtes sur deux lignes au plus
  const lignes = await page.locator('table.individuel thead th').evaluateAll((ths) => ths.map((th) => {
    const r = document.createRange()
    r.selectNodeContents(th)
    return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size
  }))
  expect(Math.max(...lignes)).toBeLessThanOrEqual(2)
  const corps = page.locator('.individuel-excel .panneau-corps').first()
  // Total MS et Total Staff figés en bas du cadre, même tableau défilé en haut
  await corps.evaluate((c) => { c.scrollTop = 0 })
  const pied = await page.evaluate(() => {
    const c = document.querySelector<HTMLElement>('.individuel-excel .panneau-corps')!
    const t = document.querySelector('table.individuel tbody.pied-fige')!
    return { bas: t.getBoundingClientRect().bottom, cadre: c.getBoundingClientRect().bottom, deborde: c.scrollHeight > c.clientHeight + 1 }
  })
  if (pied.deborde) expect(pied.bas).toBeLessThanOrEqual(pied.cadre + 1)
  await expect(page.locator('table.individuel tbody.pied-fige tr.total').first()).toBeInViewport()
  await corps.evaluate((c) => { c.scrollLeft = c.scrollWidth })
  await expect(page.locator('table.individuel thead th.fige-d1')).toBeInViewport()
  await expect(page.locator('table.individuel thead th.fige-g')).toBeInViewport()
  await page.screenshot({ path: 'test-results/individuel-activite.png', clip: { x: 0, y: 150, width: 1440, height: 260 } })
})

test('rail : points fixes, le bouton remonte en haut sur la dernière section', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await connecter(page, ADMIN)
  await page.goto('graphes')
  await expect.poll(() => page.locator('.snap-section').count(), { timeout: 20_000 }).toBeGreaterThan(1)
  const points = page.locator('.rail-point')
  const y0 = (await points.first().boundingBox())!.y
  await points.last().click()
  await expect(points.last()).toHaveClass(/actif/)
  await expect(page.locator('.rail-suite.haut')).toBeVisible()
  expect(Math.abs((await points.first().boundingBox())!.y - y0)).toBeLessThan(1)
  await page.locator('.rail-suite').click()
  await expect(points.first()).toHaveClass(/actif/)
})

test('graphes 1912×995 : aucune barre de défilement inutile', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1912, height: 995 })
  await connecter(page, ADMIN)
  await page.goto('graphes')
  await expect.poll(() => page.locator('.snap-section').count(), { timeout: 20_000 }).toBeGreaterThan(1)
  await page.waitForLoadState('networkidle')
  const debords = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.snap-section')].filter((s) => s.scrollHeight > s.clientHeight + 1).length,
  )
  expect(debords).toBe(0)
})
