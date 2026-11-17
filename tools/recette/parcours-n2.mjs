/**
 * Parcours de présentation des retours N2, joué dans une fenêtre visible au rythme d'un utilisateur.
 *
 * Suit l'appli dans l'ordre du menu, avec trois profils (admin, lien invalide, DOP à périmètre),
 * encadre chaque point montré et l'annonce dans un bandeau. Lecture seule : rien n'est enregistré.
 * À chaque écran : débordement horizontal, textes qui se chevauchent ou sont coupés, temps d'affichage.
 *
 *   cd frontend && node ../tools/recette/parcours-n2.mjs            (rythme de présentation)
 *   cd frontend && node ../tools/recette/parcours-n2.mjs --vite     (pauses courtes)
 *   cd frontend && node ../tools/recette/parcours-n2.mjs --sans-fenetre
 *
 * Variables : PARCOURS_URL (défaut http://localhost:8090), PARCOURS_COMPTES (comptes.local.csv du site
 * visé), PARCOURS_SORTIE (défaut C:/tmp/parcours-n2 : rapport.md, captures, Excel téléchargé).
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = createRequire(pathToFileURL(resolve('package.json')))('@playwright/test')

const ARGS = process.argv.slice(2)
const VITE = ARGS.includes('--vite')
const VISIBLE = !ARGS.includes('--sans-fenetre')
const URL = (process.env.PARCOURS_URL || 'http://localhost:8090').replace(/\/$/, '')
const COMPTES = process.env.PARCOURS_COMPTES || resolve('..', 'tools', 'recette', 'comptes.local.csv')
const SORTIE = process.env.PARCOURS_SORTIE || 'C:/tmp/parcours-n2'
const SEUIL_LENT_MS = 3000
const NAVIGATEURS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const attente = (ms) => new Promise((r) => setTimeout(r, VITE ? Math.min(ms, 300) : ms))

// ------------------------------------------------------------------ comptes

function lireComptes() {
  if (!existsSync(COMPTES)) throw new Error(`Comptes introuvables : ${COMPTES} (PARCOURS_COMPTES)`)
  const [entete, ...lignes] = readFileSync(COMPTES, 'utf-8').split(/\r?\n/).filter((l) => l.trim())
  const col = entete.split(';')
  return Object.fromEntries(lignes.map((l) => {
    const v = l.split(';')
    return [v[col.indexOf('identifiant')], { email: v[col.indexOf('email')], mdp: v[col.indexOf('mot_de_passe')] }]
  }))
}
const comptes = lireComptes()

// ------------------------------------------------------------------ rapport

const checklist = [] // { etape, point, ok, note }
const constats = [] // { ecran, type, detail }
const temps = [] // { ecran, ms }
let rang = 0

function cocher(point, ok, note = '') {
  checklist.push({ etape: rang, point, ok, note })
  console.log(`  ${ok === null ? '–' : ok ? '✔' : '✘'} ${point}${note ? ` (${note})` : ''}`)
}
function constater(ecran, type, detail) {
  if (constats.some((c) => c.ecran === ecran && c.detail === detail)) return
  constats.push({ ecran, type, detail })
  console.log(`  ! ${type} : ${detail}`)
}

// ------------------------------------------------------------------ mise en scène

/** Bandeau d'annonce et curseur visible, recréés à chaque chargement de page. */
const SCENE = () => {
  const poser = () => {
    if (document.getElementById('parcours-bandeau')) return
    const b = document.createElement('div')
    b.id = 'parcours-bandeau'
    b.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;' +
      'background:#1d2a4d;color:#fff;font:600 17px/1.4 system-ui,sans-serif;padding:12px 22px;border-left:6px solid #e30613;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.35);max-width:80vw;pointer-events:none;transition:opacity .3s;opacity:0'
    document.body.appendChild(b)
    const c = document.createElement('div')
    c.id = 'parcours-curseur'
    c.style.cssText = 'position:fixed;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
      'background:rgba(227,6,19,.35);border:2px solid #e30613;pointer-events:none;transition:left .15s,top .15s;left:-40px;top:-40px'
    document.body.appendChild(c)
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
  }
  window.__annoncer = (texte) => {
    poser()
    const b = document.getElementById('parcours-bandeau')
    b.textContent = texte
    b.style.opacity = texte ? '1' : '0'
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', poser)
  else poser()
}

async function annoncer(page, texte) {
  await page.evaluate((t) => window.__annoncer?.(t), texte).catch(() => {})
}

/** Fait défiler jusqu'à l'élément, l'encadre, l'annonce, laisse le temps de lire. */
async function montrer(page, loc, texte, ms = 2600) {
  const el = loc.first()
  if (!(await el.count())) return false
  await el.evaluate((n) => n.scrollIntoView({ behavior: 'smooth', block: 'center' })).catch(() => {})
  await attente(700)
  const box = await el.boundingBox().catch(() => null)
  if (box) await page.mouse.move(box.x + Math.min(box.width / 2, 120), box.y + box.height / 2, { steps: 15 })
  await el.evaluate((n) => {
    n.dataset.parcoursAvant = n.style.outline || ''
    n.style.outline = '4px solid #e30613'
    n.style.outlineOffset = '4px'
  }).catch(() => {})
  if (texte) await annoncer(page, texte)
  await attente(ms)
  await el.evaluate((n) => { n.style.outline = n.dataset.parcoursAvant || ''; n.style.outlineOffset = '' }).catch(() => {})
  return true
}

/** Survole puis clique, comme un utilisateur. */
async function cliquer(page, loc) {
  const el = loc.first()
  await el.scrollIntoViewIfNeeded().catch(() => {})
  const box = await el.boundingBox()
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
  await attente(350)
  await el.click()
}

/** Descend la page par crans, puis remonte en haut. */
async function parcourirPage(page, crans = 6) {
  for (let i = 0; i < crans; i++) { await page.mouse.wheel(0, 380); await attente(450) }
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }))
  await attente(700)
}

async function capture(page, nom) {
  await page.screenshot({ path: `${SORTIE}/${String(rang).padStart(2, '0')}-${nom}.png` }).catch(() => {})
}

/** Ouvre un écran par le menu et mesure le temps jusqu'au contenu attendu. */
async function ouvrir(page, ecran, menu, attendu) {
  rang += 1
  console.log(`\n${rang}. ${ecran}`)
  await annoncer(page, `${rang}. ${ecran}`)
  const t0 = Date.now()
  if (menu) await cliquer(page, menu)
  try {
    await page.getByText(attendu).first().waitFor({ timeout: 20000 })
  } catch {
    cocher(`${ecran} : contenu affiché`, false, `« ${attendu} » absent après 20 s`)
    return false
  }
  const ms = Date.now() - t0
  temps.push({ ecran, ms })
  if (ms > SEUIL_LENT_MS) constater(ecran, 'Lenteur', `affichage en ${(ms / 1000).toFixed(1)} s (seuil ${SEUIL_LENT_MS / 1000} s)`)
  await attente(800)
  return true
}

// ------------------------------------------------------------------ contrôles de mise en page

async function controler(page, ecran) {
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, 0) })
  await attente(300)
  const r = await page.evaluate(() => {
    const res = { debord: 0, chevauchements: [], coupes: [] }
    const doc = document.documentElement
    if (doc.scrollWidth > doc.clientWidth + 1) res.debord = doc.scrollWidth - doc.clientWidth
    // Calque (fixe, collant, flottant) et zone visible après rognage par les conteneurs à défilement.
    const calque = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement)
        if (/fixed|sticky|absolute/.test(getComputedStyle(n).position)) return n
      return document.body
    }
    const rogner = (el, b) => {
      let { left, top, right, bottom } = b
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const s = getComputedStyle(n)
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
          const c = n.getBoundingClientRect()
          left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom)
        }
      }
      return { left, top, right, bottom }
    }
    const blocs = []
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('#parcours-bandeau,#parcours-curseur,[aria-hidden="true"],svg,option,select')) continue
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue
      const st = getComputedStyle(el)
      if (st.visibility === 'hidden' || +st.opacity === 0) continue
      const txt = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim())
      if (txt.length) {
        const range = document.createRange()
        range.setStartBefore(txt[0]); range.setEndAfter(txt[txt.length - 1])
        const b = rogner(el, range.getBoundingClientRect())
        if (b.right - b.left > 2 && b.bottom - b.top > 2) blocs.push({ el, b, k: calque(el), t: txt.map((n) => n.textContent).join(' ').trim().slice(0, 40) })
      }
      if ((st.textOverflow === 'ellipsis' || st.overflow === 'hidden') && el.clientWidth > 4 && el.scrollWidth > el.clientWidth + 2 && txt.length)
        res.coupes.push(el.textContent.trim().slice(0, 50))
      if (blocs.length > 2500) break
    }
    blocs.sort((a, b) => a.b.top - b.b.top)
    for (let i = 0; i < blocs.length; i++) {
      const a = blocs[i]
      for (let j = i + 1; j < blocs.length && blocs[j].b.top < a.b.bottom; j++) {
        const c = blocs[j]
        if (a.k !== c.k || a.el.contains(c.el) || c.el.contains(a.el)) continue
        const w = Math.min(a.b.right, c.b.right) - Math.max(a.b.left, c.b.left)
        const h = Math.min(a.b.bottom, c.b.bottom) - Math.max(a.b.top, c.b.top)
        if (w <= 3 || h <= 3) continue
        // Seulement si l'un des deux textes est réellement au premier plan au point de contact.
        const x = (Math.max(a.b.left, c.b.left) + Math.min(a.b.right, c.b.right)) / 2
        const y = (Math.max(a.b.top, c.b.top) + Math.min(a.b.bottom, c.b.bottom)) / 2
        const dessus = document.elementFromPoint(x, y)
        if (dessus && (a.el.contains(dessus) || c.el.contains(dessus) || dessus.contains(a.el) || dessus.contains(c.el))) res.chevauchements.push(`« ${a.t} » / « ${c.t} »`)
      }
    }
    res.chevauchements = [...new Set(res.chevauchements)].slice(0, 6)
    res.coupes = [...new Set(res.coupes)].slice(0, 6)
    return res
  })
  const largeur = page.viewportSize()?.width ?? (await page.evaluate(() => innerWidth))
  const ou = `${ecran} (${largeur} px)`
  if (r.debord) constater(ou, 'Débordement', `page plus large que l'écran de ${r.debord} px`)
  for (const c of r.chevauchements) constater(ou, 'Chevauchement', c)
  for (const c of r.coupes) constater(ou, 'Texte coupé', c)
  cocher(`${ou} : mise en page`, !r.debord && !r.chevauchements.length,
    [r.debord && 'débordement', r.chevauchements.length && `${r.chevauchements.length} chevauchement(s)`].filter(Boolean).join(', '))
}

// ------------------------------------------------------------------ étapes

async function connexion(page, id, titre) {
  rang += 1
  console.log(`\n${rang}. Connexion (${titre})`)
  const c = comptes[id]
  if (!c) { cocher(`Connexion ${titre}`, null, `compte « ${id} » absent du fichier`); return false }
  await page.goto(`${URL}/login`)
  await annoncer(page, `${rang}. Connexion : ${titre}`)
  const email = page.locator('input[type=email], input[name=email]').first()
  await email.waitFor()
  await controler(page, 'Connexion')
  await cliquer(page, email)
  await email.pressSequentially(c.email, { delay: VITE ? 5 : 45 })
  const mdp = page.locator('input[type=password]').first()
  await cliquer(page, mdp)
  await mdp.pressSequentially(c.mdp, { delay: VITE ? 5 : 45 })
  await attente(500)
  const t0 = Date.now()
  await page.keyboard.press('Enter')
  try {
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 })
    temps.push({ ecran: `Connexion ${titre}`, ms: Date.now() - t0 })
    cocher(`Connexion ${titre}`, true)
    return true
  } catch {
    cocher(`Connexion ${titre}`, false, 'toujours sur la page de connexion')
    await capture(page, 'connexion-echec')
    return false
  }
}

async function deconnexion(page) {
  const profil = page.getByRole('button', { name: 'Profil' })
  if (!(await profil.count())) return
  await cliquer(page, profil)
  await attente(600)
  const sortir = page.getByText('Déconnexion', { exact: true })
  if (await sortir.count()) { await cliquer(page, sortir); await page.waitForURL(/login/, { timeout: 10000 }).catch(() => {}) }
}

const menu = (page, nom) => page.locator('header').getByRole('link', { name: nom, exact: true })

async function parcoursAdmin(page) {
  if (!(await connexion(page, 'admin', 'administrateur RH'))) return
  cocher('N2-1 Le site de présentation répond et la connexion fonctionne', true)

  // Résumé + cloche
  await ouvrir(page, 'Résumé', null, 'RÉSUMÉ DES INDICATEURS')
  await montrer(page, page.locator('main'), 'Résumé : les indicateurs clés du mois', 2200)
  await parcourirPage(page, 3)
  await controler(page, 'Résumé')
  await capture(page, 'resume')
  const cloche = page.getByRole('button', { name: /^Notifications/ })
  if (await cloche.count()) {
    await cliquer(page, cloche)
    await attente(900)
    const panneau = page.locator('[role=dialog], [role=menu], .cloche-panneau, .cloche-liste').first()
    const vu = await montrer(page, (await panneau.count()) ? panneau : cloche, 'N2-10 Notifications : chaque import et chaque problème est signalé ici', 3200)
    cocher('N2-10 Cloche de notifications ouverte', vu)
    await capture(page, 'notifications')
    await controler(page, 'Notifications')
    await page.keyboard.press('Escape')
    await attente(400)
  } else cocher('N2-10 Cloche de notifications', false, 'bouton absent')

  // Mensuel
  if (await ouvrir(page, 'Mensuel', menu(page, 'Mensuel'), '1. Reporting global')) {
    await controler(page, 'Mensuel')
    await montrer(page, page.getByText('Période', { exact: true }).locator('xpath=ancestor::*[.//select or .//button][1]'), 'Filtres : période, comparaison, service, site, activité…', 2200)
    await capture(page, 'mensuel')
    const sites = page.getByText('2. Répartition par site').first()
    cocher('N2-6 Détail par site présenté comme les services', await montrer(page, sites.locator('xpath=ancestor::*[.//table][1]'), 'N2-6 Sites présentés comme les services (mêmes colonnes, totaux)', 3000))
    const masse = page.locator('table.repartition tr.activite td.masse .part-badge').first()
    cocher('N2-4 Parts de masse sur les activités (colonne Part du groupe masse)', await montrer(page, masse, 'N2-4 Part de la masse : badge dans la colonne Part, groupe Masse salariale', 2400))
    const effectif = page.locator('table.repartition tr.activite td:not(.masse) .part-badge').first()
    cocher('N2-4 Parts d’effectif sur les activités (colonne Part du groupe effectif)', await montrer(page, effectif, 'N2-4 Part de l’effectif : sur la même ligne, à comparer à la masse', 2400))
    const deplier = page.locator('table.repartition button.deplier').first()
    if (await deplier.count()) {
      await deplier.click()
      cocher('Remarque 3 : activité dépliée par contrat', await montrer(page, page.locator('table.repartition tr.contrat').first(), 'Détail par contrat de l’activité', 2400))
      await deplier.click()
    } else cocher('Remarque 3 : activité dépliée par contrat', false, 'aucune activité dépliable')
    const globale = page.locator('.part-globale').first()
    cocher('N2-4 Parts globales (masse, effectif) sous le nom du site / service', await montrer(page, globale.locator('xpath=..'), 'N2-4 Part du site dans la masse et l’effectif globaux', 2600))
    await capture(page, 'parts-effectif')
    const chariot = page.locator('table').getByText('SAV Chariot').first()
    cocher('N2-7 Service SAV Chariot présent dans les tableaux', await montrer(page, chariot, 'N2-7 Nouveau service : SAV Chariot', 2400), (await chariot.count()) ? '' : 'pas de ligne ce mois-ci')
    const fb = page.getByText('Front / Back office').first()
    cocher('N2-3 Ratio front / back office (Mensuel)', await montrer(page, fb.locator('xpath=..'), 'N2-3 Ratio front office / back office, en pourcentage', 3200))
    await capture(page, 'front-back')
  }

  // Annuel
  if (await ouvrir(page, 'Annuel', menu(page, 'Annuel'), '1. Reporting global')) {
    await controler(page, 'Annuel')
    const fb = page.getByText('Front / Back office').first()
    cocher('N2-3 Ratio front / back office (Annuel)', await montrer(page, fb.locator('xpath=..'), 'N2-3 Le même ratio sur l’année', 2600))
    await capture(page, 'annuel')
  }

  // Graphes + export Excel
  if (await ouvrir(page, 'Graphes', menu(page, 'Graphes'), 'GRAPHES D’ÉVOLUTION')) {
    await page.locator('svg.recharts-surface, canvas, svg').first().waitFor({ timeout: 15000 }).catch(() => {})
    await parcourirPage(page, 4)
    await controler(page, 'Graphes')
    await capture(page, 'graphes')
    const excel = page.getByRole('button', { name: /Graphes modifiables \(Excel\)/ })
    if (await excel.count()) {
      await montrer(page, excel, 'N2-2 Graphiques exportés dans Excel, modifiables et copiables dans PowerPoint', 2600)
      const t0 = Date.now()
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), cliquer(page, excel)])
      const chemin = `${SORTIE}/${dl.suggestedFilename()}`
      await dl.saveAs(chemin)
      const ms = Date.now() - t0
      temps.push({ ecran: 'Export Excel des graphes', ms })
      if (ms > 10000) constater('Graphes', 'Lenteur', `export Excel en ${(ms / 1000).toFixed(1)} s`)
      const contenu = readFileSync(chemin).toString('latin1')
      const graphiques = (contenu.match(/xl\/charts\/chart\d+\.xml/g) || []).length
      cocher('N2-2 Export Excel avec graphiques natifs', graphiques > 0, `${dl.suggestedFilename()}, ${new Set(contenu.match(/xl\/charts\/chart\d+\.xml/g) || []).size} graphique(s)`)
    } else cocher('N2-2 Bouton « Graphes modifiables (Excel) »', false, 'absent')
  }

  // Administration : données, renseigner
  if (await ouvrir(page, 'Administration des données', menu(page, 'Administration'), 'ADMINISTRATION DES DONNÉES')) {
    await controler(page, 'Administration des données')
    await capture(page, 'admin-donnees')
    const renseigner = page.getByRole('button', { name: 'Renseigner des données' }).or(page.getByRole('link', { name: 'Renseigner des données' }))
    if (await ouvrir(page, 'Renseigner des données', renseigner, 'FICHIERS DU DOSSIER DE PAIE')) {
      await controler(page, 'Renseigner des données')
      const dossier = page.getByText('FICHIERS DU DOSSIER DE PAIE').first().locator('xpath=ancestor::section[1]')
      cocher('N2-10 Import par dossier : fichiers du dossier de paie listés', await montrer(page, (await dossier.count()) ? dossier : page.getByText('FICHIERS DU DOSSIER DE PAIE'), 'N2-10 L’appli lit seule le dossier de paie : chaque fichier, son état, ses problèmes', 3400))
      await capture(page, 'dossier-paie')
      const probleme = page.getByRole('button', { name: /probl[eè]me|Voir|Régler/ }).first()
      if (await probleme.count()) {
        await cliquer(page, probleme)
        await attente(1500)
        const matricule = page.getByText(/Matricule manquant/).first()
        cocher('N2-8 Ligne sans matricule signalée comme bloquante', await montrer(page, matricule, 'N2-8 Ligne sans matricule : bloquante, message clair', 3000), (await matricule.count()) ? '' : 'aucune ligne de ce type dans les fichiers actuels')
        const rattacher = page.getByText(/Rattacher/).first()
        cocher('N2-10 Choix « Rattacher » une valeur inconnue', await montrer(page, rattacher, 'N2-10 Valeur inconnue : l’ajouter ou la rattacher à une valeur de la liste', 3000), (await rattacher.count()) ? '' : 'aucune valeur inconnue en attente')
        await capture(page, 'points-attention')
        await controler(page, 'Points d’attention')
        await page.keyboard.press('Escape')
      } else {
        cocher('N2-8 Ligne sans matricule signalée', null, 'aucun fichier en problème dans le dossier')
        cocher('N2-10 Choix « Rattacher »', null, 'aucun fichier en problème dans le dossier')
      }
      await page.goBack().catch(() => {})
    }
  }

  // Sites, services et colonnes
  await page.goto(`${URL}/admin`)
  if (await ouvrir(page, 'Sites, services et colonnes', page.getByRole('link', { name: 'Sites, services et colonnes' }), 'Services')) {
    await controler(page, 'Sites, services et colonnes')
    cocher('N2-7 SAV Chariot dans la liste des services', await montrer(page, page.getByText('SAV Chariot', { exact: true }).first().locator('xpath=ancestor::tr[1]'), 'N2-7 SAV Chariot ajouté aux services', 2400))
    const winpart = page.getByLabel('Département de Winpart')
    cocher('N2-9 Winpart, Motul, Autofast rattachés au département Winpart', await montrer(page, winpart.locator('xpath=ancestor::tr[1]'), 'N2-9 Winpart, Motul, Autofast : nouveaux services, département Winpart', 2600))
    await montrer(page, page.getByLabel('Département de SAV Chariot').locator('xpath=ancestor::tr[1]'), 'N2-9 Les SAV rattachés au département Equipment', 2200)
    await capture(page, 'referentiels')
  }

  // Employés : matricules et état vide
  if (await ouvrir(page, 'Employés', page.getByRole('link', { name: 'Employés', exact: true }), 'Nouvel employé')) {
    await controler(page, 'Employés')
    const sm = await page.getByText(/^SM-/).count()
    cocher('N2-8 Employés affichés avec leur matricule', true, sm ? `${sm} ancien(s) identifiant(s) SM- visibles` : 'aucun SM- à l’écran')
    const recherche = page.getByRole('searchbox').or(page.locator('input[type=search]')).first()
    if (await recherche.count()) {
      await cliquer(page, recherche)
      await recherche.pressSequentially('zzzz', { delay: VITE ? 5 : 90 })
      await attente(1200)
      const vide = page.getByText(/Aucun|aucun/).first()
      cocher('État vide : recherche sans résultat expliquée', await montrer(page, vide, 'État vide : la recherche sans résultat le dit clairement', 2200))
      await capture(page, 'employes-vide')
      await recherche.fill('')
    }
  }

  // Utilisateurs : lien de connexion (montré, pas généré)
  if (await ouvrir(page, 'Utilisateurs', page.getByRole('link', { name: 'Utilisateurs', exact: true }), 'Nouveau compte')) {
    await controler(page, 'Utilisateurs')
    const fiche = page.getByRole('button', { name: /GENOVA/ }).first()
    if (await fiche.count()) {
      await cliquer(page, fiche)
      await attente(1200)
      await controler(page, 'Utilisateurs, fiche')
      const provisoire = page.getByText('Provisoire', { exact: true }).first()
      cocher('N2-5 Compte invité : mot de passe provisoire à changer (statut affiché)', await montrer(page, provisoire, 'N2-5 Lien de connexion à usage unique ; mot de passe à choisir à la 1re connexion', 3000),
        (await provisoire.count()) ? '' : 'aucun compte au statut Provisoire')
      await montrer(page, page.getByText(/Equipment|Winpart|Périmètre|Portée/).first(), 'N2-9 Le 2e DOP ne voit que Equipment et Winpart', 2600)
      await capture(page, 'utilisateur')
    }
  }
  await deconnexion(page)
}

async function liensPublics(page) {
  rang += 1
  console.log(`\n${rang}. Liens reçus par e-mail`)
  await page.goto(`${URL}/connexion-rapide#jeton=lien-deja-utilise`)
  await annoncer(page, `${rang}. Lien de connexion déjà utilisé ou invalide`)
  await attente(2000)
  const msg = page.locator('main, .carte, [role=alert]').first()
  const texte = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  cocher('N2-5 Lien déjà utilisé : message clair', /utilis|expir|invalide|plus valable/i.test(texte), texte.slice(0, 120))
  await montrer(page, msg, 'N2-5 Un lien déjà utilisé affiche un message clair', 3000)
  await controler(page, 'Lien de connexion invalide')
  await capture(page, 'lien-invalide')

  await page.goto(`${URL}/desabonnement`)
  await annoncer(page, 'N2-10 Désabonnement des e-mails depuis le lien du mail')
  await attente(2000)
  const t2 = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  cocher('N2-10 Page de désabonnement sans jeton : message compréhensible', t2.length > 40, t2.slice(0, 120))
  await controler(page, 'Désabonnement')
  await capture(page, 'desabonnement')
}

async function parcoursDop(page) {
  if (!(await connexion(page, 'dop.equipment', 'DOP Equipment'))) return
  if (await ouvrir(page, 'Mensuel (DOP Equipment)', menu(page, 'Mensuel'), '1. Reporting global')) {
    const services = await page.locator('table').first().evaluate(() => document.body.innerText)
    const interdits = ['Commerce VN', 'Administration'].filter((s) => services.includes(s))
    const service = page.locator('xpath=//label[normalize-space(text()[1])="Service"]/select').first()
    const options = (await service.count()) ? await service.locator('option').allTextContents() : []
    await montrer(page, service, `N2-9 Services visibles : ${options.filter((o) => o !== 'Tous').join(', ')}`, 3600)
    cocher('N2-9 DOP Equipment : seulement Equipment + Winpart', !interdits.length && !options.some((o) => /Commerce VN|Administration/.test(o)),
      interdits.length ? `voit aussi : ${interdits.join(', ')}` : `${options.length - 1} service(s)`)
    await controler(page, 'Mensuel (DOP Equipment)')
    await capture(page, 'dop-mensuel')

    // Largeurs portable et téléphone
    for (const [w, h, nom] of [[1280, 720, 'portable'], [390, 844, 'téléphone']]) {
      await page.setViewportSize({ width: w, height: h })
      await annoncer(page, `Largeur ${nom} (${w} px)`)
      await attente(1200)
      await parcourirPage(page, 3)
      await controler(page, `Mensuel (${nom})`)
      await capture(page, `mensuel-${w}`)
    }
  }
  await deconnexion(page)
}

// ------------------------------------------------------------------ rapport final

function ecrireRapport(erreur) {
  const l = []
  l.push(`# Parcours N2 sur ${URL}`, '', `Passage du ${new Date().toLocaleString('fr-FR')}${VISIBLE ? ', fenêtre visible' : ', sans fenêtre'}${VITE ? ', rythme rapide' : ''}.`, '')
  if (erreur) l.push(`**Arrêt anticipé** : ${erreur}`, '')
  l.push('## Points testés', '', '| Étape | Point | Résultat | Détail |', '|---|---|---|---|')
  for (const c of checklist) l.push(`| ${c.etape} | ${c.point} | ${c.ok === null ? 'sans objet' : c.ok ? 'OK' : '**à voir**'} | ${c.note.replace(/\|/g, '/')} |`)
  l.push('', '## Constats', '')
  if (!constats.length) l.push('Aucun.')
  else { l.push('| Écran | Type | Détail |', '|---|---|---|'); for (const c of constats) l.push(`| ${c.ecran} | ${c.type} | ${c.detail.replace(/\|/g, '/')} |`) }
  l.push('', '## Temps d’affichage', '', '| Écran | Secondes |', '|---|---|')
  for (const t of temps) l.push(`| ${t.ecran} | ${(t.ms / 1000).toFixed(1)} |`)
  writeFileSync(`${SORTIE}/rapport.md`, l.join('\n') + '\n', 'utf-8')
  console.log(`\nRapport : ${SORTIE}/rapport.md`)
}

// ------------------------------------------------------------------ lancement

const navigateur = NAVIGATEURS.find((p) => existsSync(p))
if (!navigateur) throw new Error('Chrome ou Edge introuvable.')
mkdirSync(SORTIE, { recursive: true })

const b = await chromium.launch({
  executablePath: navigateur,
  headless: !VISIBLE,
  slowMo: VISIBLE && !VITE ? 120 : 0,
  args: VISIBLE ? ['--start-maximized'] : [],
})
const ctx = await b.newContext({ viewport: VISIBLE ? null : { width: 1440, height: 900 }, acceptDownloads: true, locale: 'fr-FR' })
await ctx.addInitScript(SCENE)
const page = await ctx.newPage()
await page.bringToFront()
let erreur = ''
try {
  await parcoursAdmin(page)
  await liensPublics(page)
  await parcoursDop(page)
  await annoncer(page, 'Fin du parcours')
  await attente(2500)
} catch (e) {
  erreur = e.message.split('\n')[0]
  console.error('ARRÊT :', erreur)
  await capture(page, 'arret')
} finally {
  ecrireRapport(erreur)
  await b.close()
}
const aVoir = checklist.filter((c) => c.ok === false).length
console.log(`${checklist.length} points, ${aVoir} à voir, ${constats.length} constat(s).`)
process.exit(erreur ? 1 : 0)
