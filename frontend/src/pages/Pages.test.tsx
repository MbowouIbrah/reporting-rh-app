import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthContext'
import RequireAuth from '../auth/RequireAuth'
import Charges from './Charges'
import Graphes from './Graphes'
import Individuel from './Individuel'
import Resume from './Resume'

// Série mensuelle avec CA et marge renseignés (droit marge).
let serieCa = false
// Cumuls CA renseignés (comparaison avec évolution positive, CA par salarié en baisse).
let cumulCa = false
const cell = (m: string | null) => ({ m1: m, m, var: '0', var_pct: '0' })
const serie = Array.from({ length: 12 }, (_, i) => ({
  mois: i + 1, ms: i < 2 ? '1000' : null, effectif: null, absences: null, commissions: null, primes: null,
  salaire: i < 2 ? '700' : null, primes_toutes: i < 2 ? '120' : null,
}))

function routes(avecMarge: boolean, perms: string[]) {
  return (url: string): unknown => {
    if (url.includes('/auth/me')) return { id: 1, email: 'a@b.c', fonction: '', permissions: perms }
    if (url.includes('/rapports/periodes')) return [{ annee: 2026, mois: 2 }]
    if (url.includes('/rapports/filtres')) return { services: [], sites: [], types_site: ['principal', 'agence'], postes: ['Chef atelier'] }
    if (url.includes('/rapports/individuel/tous')) return {
        annee: 2026, matricule: null, nom: null,
        rubriques: ['Salaire brut garanti', 'Commission', 'Logement site déporté'],
        exclues: ['Salaire brut garanti'],
        mois: [
          { mois: 1, present: true, effectif: 2, deporte: false, total: '150',
            montants: { 'Salaire brut garanti': '900', Commission: '150', 'Logement site déporté': '0' },
            staff: { 'Salaire brut garanti': 2, Commission: 1, 'Logement site déporté': 0 } },
          { mois: 2, present: false },
        ],
      }
    if (url.includes('/rapports/salaries')) return [{ matricule: 'E1', nom: 'Ann' }]
    if (url.includes('/rapports/charges')) {
      const vide = { lignes: [], budget_raison: null, budget_total: null }
      return {
        du: '2026-01', au: '2026-02', partiel: false, total: cell('1000'), effectif: { n: 4, n1: 3, var: 1, var_pct: '0.3333' }, entrees: 1, sorties: 0,
        hors_total: { montant: '0', nb_rubriques: 0 },
        axes: { type: vide, site: vide, service: vide, activite: vide, contrat: vide },
        effectifs_contrat: [], activite: null, lignes_ca_marge: null, cout_par_vente: { n: null, n1: null, var: null, var_pct: null }, objectifs_atteints: null,
      }
    }
    if (url.includes('/rapports/annuel'))
      return {
        serie_n: serie.map((s) => (avecMarge ? { ...s, ca: serieCa && s.mois <= 2 ? '5000' : null, marge: serieCa && s.mois <= 2 ? '800' : null, taux_marge: null } : s)),
        serie_n1: serie, cumul_ytd: { ...cell('2000'), nb_mois: 2, nb_mois_n1: 2 },
        moyenne_mensuelle: cell('1000'), cumul_annee_n1: null, par_service: [],
        commissions_cumul: cell('10'), primes_cumul: cell('5'), effectif_moyen: cell('4'),
        frais_mission_ytd: '7', logement_ytd: '3', mois_fin: 2, effectif_fin: cell('4'),
        effectif_fin_contrat: { CDI: { ...cell('3'), part: '0.75' }, MAD: { ...cell('1'), part: '0.25' } },
        effectif_moyen_mad: cell('3'), part_mad: { m: '0.2', m1: '0.25' },
        mad_fin: cell('2'), mad_deportes_fin: { ...cell('1'), part: '0.5' },
        ms_contrat: { CDI: { ...cell('1500'), part: '0.75' }, MAD: { ...cell('500'), part: '0.25' } },
        ...(avecMarge ? (cumulCa
          ? { ca_ytd: '10000', marge_ytd: null, ca_cumul: { m: '10000', m1: '8000', var: '2000', var_pct: '0.25' }, ca_par_effectif: { m: '2500', m1: '3000', var: '-500', var_pct: '-0.1667' } }
          : { ca_ytd: null, marge_ytd: null, ca_cumul: cell(null), ca_par_effectif: cell(null) }) : {}),
        activite: null,
        a_type_charge: [], b_service_activite: [], c_site: [],
        d_contrat: { effectifs: [], indicateurs: [{ contrat: 'TOTAL', debut: null, recrutements: null, departs: null, fin: 0, taux_rotation: null, absences: '0', taux_absenteisme: null }], ventilation: [], total: cell('0') },
      }
    return {}
  }
}

function rendu(ui: ReactNode, chemin: string, perms: string[], avecMarge = false) {
  const r = routes(avecMarge, perms)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => new Response(JSON.stringify(r(String(u)))))
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter initialEntries={[chemin]}>
          <Routes>
            <Route path="/individuel" element={<RequireAuth perm="nominatif:read">{ui}</RequireAuth>} />
            <Route path="*" element={<RequireAuth>{ui}</RequireAuth>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

/** Carte de détail unique des cases, affichée. */
const bulle = () => document.querySelector<HTMLElement>('.bulle-case.visible')!
/** Survol d'une case : la carte s'ouvre après un court délai. */
async function survoler(el: Element) {
  fireEvent.pointerEnter(el)
  await waitFor(() => expect(document.querySelector('.bulle-case.visible')).not.toBeNull())
}
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Le squelette a la structure de la page : attendre la fin du chargement avant de lire les valeurs. */
async function chargee() {
  await waitFor(() => expect(document.querySelector('.page-ecran[aria-busy="true"]')).not.toBeNull())
  await waitFor(() => expect(document.querySelector('.page-ecran[aria-busy="true"]')).toBeNull())
}

test('Résumé : marge vide (jamais 0) quand le CA est absent', async () => {
  rendu(<Resume />, '/resume', ['report:read', 'marge:read'], true)
  await chargee()
  const tuile = (await screen.findByText('Marge', { selector: '.micro' })).closest('.tuile')!
  expect(tuile).toHaveTextContent('—')
  expect(tuile).not.toHaveTextContent('0')
  expect(tuile).toHaveTextContent(/Taux de marge\s*—/)
  expect(tuile).not.toHaveTextContent('vs')
  expect(screen.getByText('CA par salarié', { selector: '.micro' })).toBeInTheDocument()
  expect(screen.queryByText(/Masse salariale \d{4}/)).toBeNull()
})

test('Résumé : effectif global de fin, évolution et répartition par contrat dans la carte', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  await chargee()
  const tuile = (await screen.findByText('Effectif global', { selector: '.micro' })).closest('.tuile')!
  expect(tuile).toHaveTextContent(/Effectif global4Évolution par rapport à Janv\. 2026/)
  await survoler(tuile)
  expect(bulle().querySelector('h2')).toHaveTextContent('Effectif global')
  expect(bulle().querySelector('header p')).toHaveTextContent(/Fin Févr. 2026 · comparé à Janv\. 2026/)
  expect(bulle()).toHaveTextContent(/Par type de contrat.*CDI3MAD1/)
  expect(bulle()).toHaveTextContent(/Salariés présents à la fin du dernier mois saisi/)
  expect(tuile).toHaveAttribute('aria-describedby', bulle().id)
  expect(bulle()).toHaveAttribute('role', 'tooltip')
  expect([...bulle().querySelectorAll('section > h3')].map((h) => h.textContent)).toEqual(
    expect.arrayContaining(['Comparaison', 'Par type de contrat', 'Calcul']),
  )
  expect(document.querySelector('.cases')).not.toHaveTextContent(/mois saisi/)
  expect(screen.queryByText('CA par salarié', { selector: '.micro' })).toBeNull()
})

test('Résumé : part des MAD d’abord, sites déportés dessous, détail dans la carte, masse salariale par contrat', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  await chargee()
  const tuile = (await screen.findByText('Pourcentage MAD sites déportés')).closest('.tuile')!
  expect(tuile).toHaveTextContent(/Part des MAD20\s%Pourcentage MAD sites déportés1 · 50\s%/)
  await survoler(tuile)
  expect(bulle()).toHaveTextContent(/MAD3Total4/)
  expect(bulle()).toHaveTextContent(/dont sites déportés1 · 1Part des sites déportés50\s%/)
  const ms = screen.getByText('Masse salariale', { selector: '.micro' }).closest('.tuile')!
  fireEvent.pointerLeave(tuile)
  fireEvent.pointerEnter(ms)
  // Une seule carte pour toutes les cases : elle passe d'une case à l'autre.
  await waitFor(() => expect(bulle().querySelector('h2')).toHaveTextContent('Masse salariale'))
  expect(document.querySelectorAll('.bulle-case')).toHaveLength(1)
  expect(bulle()).toHaveTextContent(/MAD500\sFCFA\s25,0\s%/)
  expect(bulle()).toHaveTextContent(/Moyenne par mois/)
  expect(bulle()).not.toHaveTextContent(/Mois saisis/)
  expect(tuile).not.toHaveAttribute('aria-describedby')
  expect(screen.queryByText(/MOYENNE MENSUELLE/)).toBeNull()
})

test('Résumé : la carte reste ouverte sous le pointeur, se ferme en le quittant', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  await chargee()
  const tuile = (await screen.findByText('Commissions', { selector: '.micro' })).closest('.tuile')!
  await survoler(tuile)
  // Passage de la case à la carte : la fermeture différée est annulée.
  fireEvent.pointerLeave(tuile)
  fireEvent.pointerEnter(bulle())
  await attendre(350)
  expect(bulle()).not.toBeNull()
  fireEvent.pointerLeave(bulle())
  await waitFor(() => expect(document.querySelector('.bulle-case.visible')).toBeNull(), { timeout: 1500 })
})

test('Résumé : Échap ferme la carte, le focus clavier l’ouvre aussitôt', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  await chargee()
  const tuile = (await screen.findByText('Commissions', { selector: '.micro' })).closest('.tuile')!
  expect(document.querySelector('.bulle-case.visible')).toBeNull()
  fireEvent.focus(tuile)
  expect(bulle().querySelector('h2')).toHaveTextContent('Commissions')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(document.querySelector('.bulle-case.visible')).toBeNull()
})

test('Résumé : pas de carte de détail pendant le chargement (valeurs pas encore à jour)', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  // Lu dans le même passage que l'état occupé : en test, la réponse arrive aussitôt après.
  const tuile = await waitFor(() => {
    expect(document.querySelector('.page-ecran[aria-busy="true"]')).not.toBeNull()
    return screen.getByText('Commissions', { selector: '.micro' }).closest('.tuile')!
  })
  expect(tuile).not.toHaveAttribute('data-carte-case')
  fireEvent.focus(tuile)
  expect(document.querySelector('.bulle-case.visible')).toBeNull()
  await waitFor(() => expect(document.querySelector('.page-ecran[aria-busy="true"]')).toBeNull())
  fireEvent.focus(tuile)
  expect(bulle().querySelector('h2')).toHaveTextContent('Commissions')
})

test('Résumé : un clic ailleurs ferme la carte', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  await chargee()
  const tuile = (await screen.findByText('Commissions', { selector: '.micro' })).closest('.tuile')!
  fireEvent.focus(tuile)
  expect(bulle()).not.toBeNull()
  fireEvent.pointerDown(bulle())
  expect(bulle()).not.toBeNull()
  fireEvent.pointerDown(document.body)
  expect(document.querySelector('.bulle-case.visible')).toBeNull()
})

test('Résumé : au toucher, la case ouvre la carte, un second toucher la ferme', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  await chargee()
  const tuile = (await screen.findByText('Commissions', { selector: '.micro' })).closest('.tuile')!
  // jsdom n'a pas de PointerEvent : une version minimale porte le type de pointeur.
  const original = window.PointerEvent
  class PointerEventTest extends MouseEvent {
    pointerType: string
    constructor(type: string, init?: PointerEventInit) {
      super(type, init)
      this.pointerType = init?.pointerType ?? ''
    }
  }
  window.PointerEvent = PointerEventTest as unknown as typeof PointerEvent
  try {
    fireEvent.pointerDown(tuile, { pointerType: 'touch' })
    fireEvent.click(tuile)
    expect(bulle().querySelector('h2')).toHaveTextContent('Commissions')
    fireEvent.pointerDown(tuile, { pointerType: 'touch' })
    fireEvent.click(tuile)
    expect(document.querySelector('.bulle-case.visible')).toBeNull()
  } finally {
    window.PointerEvent = original
  }
})

test('Résumé : variation neutre sur les commissions, verte ou rouge sur le CA et le CA par salarié', async () => {
  cumulCa = true
  try {
    rendu(<Resume />, '/resume', ['report:read', 'marge:read'], true)
    await chargee()
    const ouvrir = async (titre: string) => {
      const t = (await screen.findByText(titre, { selector: '.micro' })).closest('.tuile')!
      fireEvent.focus(t)
      await waitFor(() => expect(bulle().querySelector('h2')).toHaveTextContent(titre))
      return bulle()
    }
    const ca = await ouvrir('Chiffre d’affaires')
    expect(ca.querySelector('.bc-bon')).toHaveTextContent(/▲ \+25\s%/)
    expect(ca.querySelector('.bc-neutre')).toBeNull()
    const parSalarie = await ouvrir('CA par salarié')
    expect(parSalarie.querySelector('.bc-mal')).toHaveTextContent(/▼/)
    const com = await ouvrir('Commissions')
    expect(com.querySelector('.bc-neutre')).not.toBeNull()
    expect(com.querySelector('.bc-bon, .bc-mal')).toBeNull()
  } finally {
    cumulCa = false
  }
})

test('Résumé : tableau avec frais de mission, logement et ligne de total', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  await chargee()
  await waitFor(() => expect(document.querySelector('.suivi tfoot')).toHaveTextContent('TOTAL'))
  const entetes = [...document.querySelectorAll('.suivi thead th')].map((t) => t.textContent)
  expect(entetes).toEqual(['MOIS', 'MASSE SALARIALE', 'COMMISSIONS', 'PRIMES PROD.', 'FRAIS DE MISSION', 'LOGEMENT SITE DÉPORTÉ'])
  expect(document.querySelector('.suivi tfoot')).toHaveTextContent(/TOTAL.*7.*3/)
})

test('Résumé : avec un filtre, tuiles CA et marge gardées avec « — »', async () => {
  rendu(<Resume />, '/resume?type_site=agence', ['report:read', 'marge:read'], true)
  await chargee()
  for (const titre of ['Chiffre d’affaires', 'Marge', 'CA par salarié']) {
    const tuile = (await screen.findByText(titre, { selector: '.micro' })).closest('.tuile')!
    expect(tuile).toHaveTextContent(`${titre}—Non disponible pour ces filtres`)
  }
  expect(screen.getByText(/ne sont pas disponibles/)).toBeInTheDocument()
})

test('Résumé : tuiles marge absentes sans la permission', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  await chargee()
  await screen.findByText('Masse salariale', { selector: '.micro' })
  expect(screen.queryByText('Marge', { selector: '.micro' })).toBeNull()
  expect(screen.queryByText('Chiffre d’affaires')).toBeNull()
})

test('Répartition des charges : pas de bandeau de cumul au-dessus des cartes', async () => {
  rendu(<Charges />, '/charges', ['report:read'])
  await screen.findByRole('link', { name: /Types de charge/ })
  expect(screen.queryByText(/Moyenne mensuelle/)).toBeNull()
})

test('Répartition des charges : filtres type de site, poste et employé (employé réservé au nominatif)', async () => {
  const { unmount } = rendu(<Charges />, '/charges', ['report:read', 'nominatif:read'])
  expect(await screen.findByRole('combobox', { name: 'Employé' })).toBeInTheDocument()
  // filtre de filtres : Département et Site par défaut, les autres ajoutés à la demande
  expect(screen.getByRole('button', { name: /^Site/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Type de site/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /^Filtres/ }))
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Type de site' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Poste' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Site' }))
  expect(screen.queryByRole('button', { name: /^Site/ })).toBeNull()
  // sélection multiple (R4) : le panneau s'ouvre au clic, une case par valeur
  fireEvent.click(await screen.findByRole('button', { name: /^Type de site/ }))
  expect(screen.getByRole('checkbox', { name: 'Agence' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /^Poste/ }))
  expect(screen.getByRole('checkbox', { name: 'Chef atelier' })).toBeInTheDocument()
  unmount()
  rendu(<Charges />, '/charges', ['report:read'])
  expect(await screen.findByRole('button', { name: /^Type de site/ })).toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Employé' })).toBeNull()
})

test('Filtres : champs rangés par groupe, filtres de profil envoyés au serveur et réinitialisés', async () => {
  rendu(<Charges />, '/charges', ['report:read'])
  fireEvent.click(await screen.findByRole('button', { name: /^Filtres/ }))
  const menu = (await screen.findAllByRole('group', { name: 'Filtres' })).find((e) => e.classList.contains('multi-menu'))!
  const textes = [...menu.querySelectorAll('.filtres-choix-groupe, label')].map((e) => e.textContent)
  expect(textes.indexOf('Profil des salariés')).toBeGreaterThan(textes.indexOf('Emploi'))
  expect(textes.indexOf('Emploi')).toBeGreaterThan(textes.indexOf('Organisation'))
  expect(textes.indexOf('Organisation')).toBeGreaterThan(textes.indexOf('Implantation'))
  expect(textes.indexOf('Poste')).toBe(textes.indexOf('Profil des salariés') - 1)
  expect(textes.indexOf('Poste')).toBeGreaterThan(textes.indexOf('Emploi'))
  expect(textes.indexOf('Sexe')).toBe(textes.indexOf('Profil des salariés') + 1)
  expect(textes).not.toContain('Masse salariale')
  expect(textes).toEqual(expect.arrayContaining(["Tranche d'âge", "Tranche d'ancienneté"]))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sexe' }))
  fireEvent.click(await screen.findByRole('button', { name: /^Sexe/ }))
  // tout est coché par défaut : décocher Femmes garde Hommes et Non renseigné
  fireEvent.click(screen.getByRole('checkbox', { name: 'Femmes' }))
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes('sexe=H%7Cnr'))).toBe(true))
  const reinit = screen.getByRole('button', { name: /Réinitialiser/ })
  fireEvent.click(reinit)
  // sans filtre actif, le bouton disparaît de l'en-tête
  await waitFor(() => expect(screen.queryByRole('button', { name: /Réinitialiser/ })).toBeNull())
})

test('Individuel : tous les salariés par défaut', async () => {
  rendu(<Individuel />, '/individuel', ['report:read', 'nominatif:read'])
  expect(await screen.findByRole('region', { name: 'Reporting individuel' })).toBeInTheDocument()
  await screen.findAllByText('150')
  const entetes = screen.getAllByRole('columnheader').map((th) => th.textContent)
  // colonnes exclues en tête, juste après le mois
  expect(entetes.slice(1, 4)).toEqual(['Salaire brut garanti', 'Commission', 'Logement site déporté'])
  const janvier = screen.getByRole('rowheader', { name: 'Janvier' }).closest('tr')!
  // logement sans objet hors site déporté, colonne exclue hachurée, total servi par le serveur
  expect(janvier.cells[1]).toHaveClass('exclu')
  expect(janvier.cells[3]).toHaveTextContent('-')
  expect(janvier.cells[4]).toHaveTextContent('150')
})

test('Individuel sans nominatif:read : renvoyé au Résumé, la page n’est pas révélée', async () => {
  // Route « * » : la redirection vers /resume affiche ce repère au lieu de la page.
  rendu(<p>Accueil</p>, '/individuel', ['report:read'])
  expect(await screen.findByText('Accueil')).toBeInTheDocument()
  expect(screen.queryByText('Accès refusé')).not.toBeInTheDocument()
})

test('Graphes : CA et marge par mois absents sans données de marge, affichés avec', async () => {
  localStorage.clear()
  const legende = (t: string) => [...document.querySelectorAll('figcaption')].some((f) => f.textContent === t)
  const { unmount } = rendu(<Graphes />, '/graphes', ['report:read'])
  // La note n'existe qu'une fois les données chargées (le squelette n'a que les titres).
  expect(await screen.findByText(/objectif de rémunération globale n’apparaît pas/i)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Tout afficher/ }))
  expect(legende('Salaire par mois (FCFA)')).toBe(true)
  expect(legende('CA par mois (FCFA)')).toBe(false)
  expect(legende('Marge par mois (FCFA)')).toBe(false)
  expect(screen.queryByRole('button', { name: /Ventes, marge et commissions/ })).toBeNull()
  unmount()
  serieCa = true
  try {
    rendu(<Graphes />, '/graphes', ['report:read', 'marge:read'], true)
    expect(await screen.findByText(/objectif de rémunération globale n’apparaît pas/i)).toBeInTheDocument()
    // la vue « tous » choisie plus haut est gardée : le bouton du menu est visé
    fireEvent.click(within(screen.getByRole('group', { name: 'Groupes de graphiques' })).getByRole('button', { name: /Ventes, marge et commissions/ }))
    await waitFor(() => expect(legende('CA par mois (FCFA)')).toBe(true))
    expect(legende('Marge par mois (FCFA)')).toBe(true)
    // un groupe à la fois : la vue d'ensemble n'est plus à l'écran
    expect(legende('Effectif')).toBe(false)
  } finally {
    serieCa = false
  }
})

test('Graphes : les groupes cochés s’affichent, choisir un groupe décoche les autres sans les retirer du menu', async () => {
  localStorage.clear()
  const legende = (t: string) => [...document.querySelectorAll('figcaption')].some((f) => f.textContent === t)
  const dansMenu = (nom: RegExp) => within(document.querySelector('details')!).getByRole('button', { name: nom })
  const garde = () => JSON.parse(localStorage.getItem('reporting-rh.pref.1.groupes.evolution')!)
  const { unmount } = rendu(<Graphes />, '/graphes', ['report:read'])
  // Ouverture : tous les groupes sont cochés, donc tous affichés
  expect(await screen.findByText(/objectif de rémunération globale n’apparaît pas/i)).toBeInTheDocument()
  expect(screen.getByText('Tous les groupes', { selector: 'summary' })).toBeInTheDocument()
  expect(legende('Masse salariale mensuelle (FCFA)')).toBe(true)
  expect(legende('Salaire par mois (FCFA)')).toBe(true)
  // Un groupe choisi devient le seul coché, les autres restent dans le menu
  fireEvent.click(dansMenu(/Salaires, primes et charges/))
  await waitFor(() => expect(legende('Masse salariale mensuelle (FCFA)')).toBe(false))
  expect(screen.getByText('Groupe : Salaires, primes et charges', { selector: 'summary' })).toBeInTheDocument()
  expect(legende('Salaire par mois (FCFA)')).toBe(true)
  expect(garde().ordre).toEqual(['salaire'])
  expect(dansMenu(/Frais et avantages/)).toBeInTheDocument()
  // Nouveau groupe personnel : coché avec le groupe déjà affiché
  fireEvent.click(dansMenu(/Personnaliser/))
  fireEvent.click(screen.getByRole('button', { name: 'Nouveau groupe' }))
  fireEvent.change(screen.getByLabelText('Nom du groupe'), { target: { value: 'Mes salaires' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Salaire par mois (FCFA)' }))
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }))
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
  expect(garde().perso).toEqual([{ id: expect.stringMatching(/^p-/), nom: 'Mes salaires', graphes: ['salaire'] }])
  expect(garde().ordre).toEqual(['salaire', garde().perso[0].id])
  unmount()
  // Rechargé : le réglage est retrouvé
  rendu(<Graphes />, '/graphes', ['report:read'])
  expect(await screen.findByText('2 groupes affichés', { selector: 'summary' })).toBeInTheDocument()
  fireEvent.click(dansMenu(/Mes salaires/))
  await waitFor(() => expect(screen.getByText('Groupe : Mes salaires', { selector: 'summary' })).toBeInTheDocument())
  expect(legende('Salaire par mois (FCFA)')).toBe(true)
  expect(legende('Primes par mois (FCFA)')).toBe(false)
  // « Tout afficher » recoche tout
  fireEvent.click(dansMenu(/Tout afficher/))
  await waitFor(() => expect(legende('Primes par mois (FCFA)')).toBe(true))
  expect(garde().ordre).toHaveLength(6)
  localStorage.clear()
})

test('Graphes : export des graphiques dynamiques, graphes cochés à l’écran puis bouton à droite du menu', async () => {
  localStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  rendu(<Graphes />, '/graphes', ['report:read'])
  await screen.findByText(/objectif de rémunération globale n’apparaît pas/i)
  fireEvent.click(screen.getByRole('button', { name: 'Exporter' }))
  fireEvent.click(screen.getByRole('button', { name: /Graphiques dynamiques/, hidden: true }))
  const exporter = screen.getByRole('button', { name: 'Exporter 0 graphe' })
  expect(exporter).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Salaire par mois (FCFA)' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Masse salariale mensuelle (FCFA)' }))
  fireEvent.click(screen.getByRole('button', { name: 'Exporter 2 graphes' }))
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Export des graphiques dynamiques' })).toBeNull())
  const url = vi.mocked(fetch).mock.calls.map((c) => String(c[0])).find((u) => u.includes('graphiques=true'))!
  expect(url).toContain('graphes=ms%2Csalaire')
  expect(screen.queryByRole('checkbox', { name: 'Salaire par mois (FCFA)' })).toBeNull()
})

test('Résumé : au tout premier chargement, le squelette a les cases, les mois et la ligne TOTAL de la page', async () => {
  sessionStorage.clear()
  rendu(<Resume />, '/resume', ['report:read', 'marge:read'])
  const zone = await waitFor(() => {
    const z = document.querySelector('.resume-excel[aria-busy="true"]')
    expect(z).not.toBeNull()
    return z!
  })
  expect(zone.querySelectorAll('.cases')).toHaveLength(2)
  expect(zone.querySelectorAll('.cases .case')).toHaveLength(8)
  expect(zone.querySelectorAll('.cases .case .second-libelle')).toHaveLength(8)
  // Réunion du 23/11 : les 12 mois du cadre, ceux hors période grisés
  expect(zone.querySelectorAll('.suivi tbody tr')).toHaveLength(12)
  expect(zone).toHaveTextContent('SUIVI MENSUEL')
  expect(zone.querySelector('.suivi tfoot')).toHaveTextContent('TOTAL')
})
