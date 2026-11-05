import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthContext'
import RequireAuth from '../auth/RequireAuth'
import Annuel from './Annuel'
import Graphes from './Graphes'
import Individuel from './Individuel'
import Mensuel from './Mensuel'
import Resume from './Resume'

// Bloc ACTIVITÉ de l'annuel : null tant qu'aucune donnée d'activité n'existe.
let activiteAnnuel: unknown = null
// Série mensuelle avec CA et marge renseignés (droit marge).
let serieCa = false
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
    if (url.includes('/rapports/mensuel'))
      return {
        synthese: {
          ms: cell('1000'), commissions: cell('10'), primes_total: cell('5'),
          ...(avecMarge ? { ca: null, marge: null, taux_marge: null } : {}),
        },
        controles: [], a_type_charge: [], b_service_activite: [], c_site: [],
        d_contrat: { effectifs: [], indicateurs: [], ventilation: [], total: cell('0') },
      }
    if (url.includes('/rapports/annuel'))
      return {
        serie_n: serie.map((s) => (avecMarge ? { ...s, ca: serieCa && s.mois <= 2 ? '5000' : null, marge: serieCa && s.mois <= 2 ? '800' : null, taux_marge: null } : s)),
        serie_n1: serie, cumul_ytd: { ...cell('2000'), nb_mois: 2, nb_mois_n1: 2 },
        moyenne_mensuelle: cell('1000'), cumul_annee_n1: null, par_service: [],
        commissions_cumul: cell('10'), primes_cumul: cell('5'), effectif_moyen: cell('4'),
        frais_mission_ytd: '7', logement_ytd: '3', mois_fin: 2, effectif_fin: cell('4'),
        effectif_fin_contrat: { CDI: { ...cell('3'), part: '0.75' }, MAD: { ...cell('1'), part: '0.25' } },
        mad_fin: cell('2'), mad_deportes_fin: { ...cell('1'), part: '0.5' },
        ms_contrat: { CDI: { ...cell('1500'), part: '0.75' }, MAD: { ...cell('500'), part: '0.25' } },
        ...(avecMarge ? { ca_ytd: null, marge_ytd: null, ca_cumul: cell(null), ca_par_effectif: cell(null) } : {}),
        activite: activiteAnnuel,
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

/** Bulle unique des cases, affichée. */
const bulle = () => document.querySelector<HTMLElement>('.bulle-case.visible')!

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

test('Résumé : effectif global de fin, évolution et répartition par contrat en bulle', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  await chargee()
  const tuile = (await screen.findByText('Évolution par rapport à Fév 2025')).closest('.tuile')!
  expect(tuile).toHaveTextContent(/Effectif global4Évolution par rapport à Fév 2025/)
  fireEvent.mouseEnter(tuile)
  expect(bulle()).toHaveTextContent(/CDI3 \(75\s%\)MAD1 \(25\s%\)/)
  expect(bulle()).not.toHaveTextContent(/Effectif fin/)
  expect(tuile).toHaveAttribute('aria-describedby', bulle().id)
  expect(document.querySelector('.cases')).not.toHaveTextContent(/mois saisi/)
  expect(screen.queryByText('CA par salarié', { selector: '.micro' })).toBeNull()
})

test('Résumé : MAD globaux, dont sites déportés avec leur part, masse salariale par contrat', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  await chargee()
  const tuile = (await screen.findByText('Pourcentage MAD sites déportés')).closest('.tuile')!
  expect(tuile).toHaveTextContent(/MAD globaux2Pourcentage MAD sites déportés1 · 50\s%/)
  fireEvent.mouseEnter(tuile)
  expect(bulle()).toHaveTextContent(/MAD sites déportés1Part des MAD globaux50\s%/)
  const ms = screen.getByText('Masse salariale', { selector: '.micro' }).closest('.tuile')!
  fireEvent.mouseLeave(tuile)
  fireEvent.mouseEnter(ms)
  // Une seule bulle pour toutes les cases : elle passe d'une case à l'autre.
  expect(document.querySelectorAll('.bulle-case')).toHaveLength(1)
  expect(bulle()).toHaveTextContent(/MAD500\sFCFA \(25\s%\)/)
  expect(bulle()).not.toHaveTextContent(/Écart|Mois saisis/)
  expect(tuile).not.toHaveAttribute('aria-describedby')
  expect(screen.queryByText(/MOYENNE MENSUELLE/)).toBeNull()
})

test('Résumé : tableau avec frais de mission, logement et ligne de total', async () => {
  rendu(<Resume />, '/resume', ['report:read'])
  await chargee()
  await screen.findByText('TOTAL')
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

test('Mensuel : pas de ligne de contrôles et d’indicateurs au-dessus des tableaux', async () => {
  rendu(<Mensuel />, '/mensuel', ['report:read'])
  await screen.findByText('1. Reporting global')
  expect(screen.queryByText(/Contrôles de cohérence/)).toBeNull()
  expect(screen.queryByText(/Effectif fin de mois/)).toBeNull()
  expect(screen.queryByText(/Taux de rotation/)).toBeNull()
})

test('Annuel : pas de bandeau de cumul au-dessus des tableaux', async () => {
  rendu(<Annuel />, '/annuel', ['report:read'])
  await screen.findByText('1. Reporting global')
  expect(screen.queryByText(/Moyenne mensuelle/)).toBeNull()
})

test('Annuel : bloc Activité masqué sans donnée, affiché avec la mention « partiel »', async () => {
  rendu(<Annuel />, '/annuel', ['report:read'])
  await screen.findByText('1. Reporting global')
  expect(screen.queryByText('6. Activité')).toBeNull()
  activiteAnnuel = [
    { cle: 'ventes', libelle: 'Ventes', ...cell('12'), partiel: true },
    { cle: 'productivite', libelle: 'Productivité', ...cell('1.5') },
  ]
  try {
    rendu(<Annuel />, '/annuel', ['report:read'])
    expect(await screen.findByText('6. Activité')).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: /Ventes\s*partiel/ })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Productivité' })).toBeInTheDocument()
  } finally {
    activiteAnnuel = null
  }
})

test('Annuel : filtres type de site, poste et employé (employé réservé au nominatif)', async () => {
  const { unmount } = rendu(<Annuel />, '/annuel', ['report:read', 'nominatif:read'])
  expect(await screen.findByRole('combobox', { name: 'Employé' })).toBeInTheDocument()
  expect(await screen.findByLabelText('Type de site')).toHaveTextContent('Agence')
  expect(await screen.findByLabelText('Poste')).toHaveTextContent('Chef atelier')
  unmount()
  rendu(<Annuel />, '/annuel', ['report:read'])
  expect(await screen.findByLabelText('Type de site')).toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Employé' })).toBeNull()
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
  expect(zone.querySelectorAll('.suivi tbody tr')).toHaveLength(12)
  expect(zone.querySelector('.suivi tfoot')).toHaveTextContent('TOTAL')
})
