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
  const box = (await section.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 200)
  await expect.poll(() => section.evaluate((s) => s.scrollTop)).toBeGreaterThan(0)
  const avant = await page.locator('.rail-point').nth(i).getAttribute('aria-label')
  // Au bout de la section, après une pause, un nouveau geste mène à la suivante
  await section.evaluate((s) => { s.scrollTop = s.scrollHeight })
  await page.waitForTimeout(500)
  await page.mouse.wheel(0, 120)
  await expect.poll(() => page.locator('.rail-point.actif').getAttribute('aria-label')).not.toBe(avant)
})
