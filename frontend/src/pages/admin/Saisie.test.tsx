import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../../auth/AuthContext'
import Saisie from './Saisie'
import BandeauEnregistre from './saisie/Enregistre'

const PREPA = {
  annee: 2026, mois: 2,
  rubriques: [{ libelle: 'Brut Réel', unite: 'FCFA' }, { libelle: 'Absences (nb)', unite: 'jours' }],
  exclues: ['Absences (nb)'],
  referentiels: { poste: ['P'], type_contrat: ['CDI'], activite: ['SAV'], site: ['Douala'], service: ['SAV PL'] },
  salaries: [
    { matricule: 'E1', nom: 'Ann', saisi: false, present_precedent: true, montants: {},
      attributs: { poste: 'P', type_contrat: 'CDI', activite: 'SAV', site: 'Douala', service: 'SAV PL' } },
    { matricule: 'E2', nom: 'Bob', saisi: true, present_precedent: false, montants: { 'Brut Réel': '500.000' },
      attributs: { poste: 'P', type_contrat: 'CDI', activite: 'SAV', site: 'Douala', service: 'SAV PL' } },
  ],
}
const LOT = { id: 7, fichier_nom: 'Saisie Février 2026', statut: 'pret', nb_lignes: 2, nb_bloquants: 0, nb_avert: 0, stats: null }
const APERCU = {
  lot: LOT, nouvelle: 1, modifiee: 1, identique: 0, effaces: 0, nouveaux_salaries: [],
  employes: { total: 2, nouveaux: 0, existants: 2 }, total_lot: '1600.000',
  absents: [{ annee: 2026, mois: 2, matricule: 'E9', nom: 'Zoe' }], nb_absents: 1,
  lignes: [
    { annee: 2026, mois: 2, matricule: 'E1', nom: 'Ann', nouveau_salarie: false, statut: 'nouvelle', total_avant: null, total_apres: '1000.000', changements: [] },
    { annee: 2026, mois: 2, matricule: 'E2', nom: 'Bob', nouveau_salarie: false, statut: 'modifiee', total_avant: '500.000', total_apres: '600.000',
      changements: [{ colonne: 'Brut Réel', avant: '500.000', apres: '600.000' }] },
  ],
}

const vide = { rubrique: [], service: [], site: [] }
const PILOTAGE = {
  annee: 2026, mois: 2, periode_id: null, ca: null, marge: null, taux_marge: null,
  budgets: { ...vide, service: [{ cible_id: 1, libelle: 'SAV PL', actif: true, exclue: false, valeur: '300.000' }] },
  totaux: { rubrique: null, service: '300.000', site: null }, reprise: null,
}

const vierge = { saisi: null, employes: null, valeur: null, origine: null, ecart: null, propose: null }
const SITES = [{ id: 1, libelle: 'Douala' }, { id: 2, libelle: 'Yaoundé' }]
const SERVICES = [{ id: 1, libelle: 'SAV PL', productif: true }]
const SAISIES_CA = {
  annee: 2026, mois: 2, groupe: 'ca_marge', periode_id: null, indicateurs: ['ca', 'marge'],
  niveau: 'global', niveau_enregistre: null, niveau_par_defaut: true, a_repartir: {}, sites: SITES, services: SERVICES,
  cases: [{
    site_id: null, service_id: null,
    valeurs: { ca: { saisi: null, employes: '800000.000', valeur: '800000.000', origine: 'calcule', ecart: null }, marge: vierge },
  }],
  totaux: {
    ca: { valeur: '800000.000', partiel: false, renseignes: 1, attendus: 1 },
    marge: { valeur: null, partiel: true, renseignes: 0, attendus: 1 },
  },
  taux_marge: null,
}
const SAISIES_ACTIVITE = {
  annee: 2026, mois: 2, groupe: 'activite', periode_id: 4, indicateurs: ['or', 'devis', 'factures'],
  niveau: 'site', niveau_enregistre: 'site', niveau_par_defaut: false, a_repartir: {}, sites: SITES, services: SERVICES,
  cases: [
    { site_id: 1, service_id: null, valeurs: {
      or: { saisi: '500.000', employes: null, valeur: '500.000', origine: 'saisi', ecart: null },
      devis: { saisi: '300.000', employes: '280.000', valeur: '300.000', origine: 'saisi', ecart: '20.000' },
      factures: vierge } },
    { site_id: 2, service_id: null, valeurs: { or: vierge, devis: vierge, factures: vierge } },
  ],
  totaux: {
    or: { valeur: '500.000', partiel: true, renseignes: 1, attendus: 2 },
    devis: { valeur: '300.000', partiel: true, renseignes: 1, attendus: 2 },
    factures: { valeur: null, partiel: true, renseignes: 0, attendus: 2 },
  },
}

const appels: { url: string; corps?: unknown }[] = []
let anomalies: unknown[] = []
let reponsePut: (corps: Record<string, unknown>) => Response = () => new Response('{}')
/** Réponse du GET /pilotage/saisies, remplaçable par un test ; sinon le niveau demandé est celui renvoyé. */
let reponseGet: ((url: URL) => unknown) | null = null
function rendu(perms = ['import:read', 'marge:read']) {
  appels.length = 0
  localStorage.clear()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
    const url = String(u)
    appels.push({ url, corps: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.includes('/derniere-periode')) return new Response(JSON.stringify({ annee: 2026, mois: 1, lignes: 3 }))
    if (url.includes('/preparation')) return new Response(JSON.stringify(PREPA))
    if (url.includes('/verifier')) {
      const n = (init && JSON.parse(String(init.body)).lignes.length) || 0
      return new Response(JSON.stringify({
        anomalies,
        totaux: Array.from({ length: n }, () => ({ total: '1000.000', exclusions: '0.000' })),
      }))
    }
    if (url.includes('/donnees/lots')) return new Response(JSON.stringify(LOT), { status: 201 })
    if (url.includes('/apercu')) return new Response(JSON.stringify(APERCU))
    if (url.includes('/valider')) return new Response(JSON.stringify({ ...LOT, statut: 'valide' }))
    if (url.includes('/auth/me')) return new Response(JSON.stringify({ id: 1, email: 'admin@exemple.invalid', fonction: '', permissions: perms }))
    if (url.includes('/pilotage/saisies')) {
      if (init?.method === 'PUT') return reponsePut(JSON.parse(String(init.body)))
      const adresse = new URL(url, 'http://localhost')
      if (reponseGet) return new Response(JSON.stringify(reponseGet(adresse)))
      const base = url.includes('groupe=activite') ? SAISIES_ACTIVITE : SAISIES_CA
      const niveau = adresse.searchParams.get('niveau')
      return new Response(JSON.stringify(niveau ? { ...base, niveau } : base))
    }
    if (url.includes('/pilotage')) return new Response(JSON.stringify(PILOTAGE))
    return new Response('{}')
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/saisie']}>
          <Routes>
            <Route path="/admin/saisie" element={<Saisie />} />
            <Route path="/admin" element={<BandeauEnregistre />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return qc
}
const ouvrirDonnees = async () => fireEvent.click(await screen.findByRole('button', { name: 'Saisir les données de Février 2026 →' }))
const saisirLeMois = async () => fireEvent.click(await screen.findByRole('button', { name: 'Étape 1 : choisir les employés de Février 2026 →' }))
afterEach(() => {
  vi.restoreAllMocks()
  reponsePut = () => new Response('{}')
  reponseGet = null
})

test('mois proposé, cases, grille avec collage Excel, aperçu et choix « garder »', async () => {
  rendu()
  // Mois suivant le dernier saisi proposé par défaut.
  await waitFor(() => expect(screen.getByLabelText('Mois')).toHaveValue('2'))
  expect(screen.getByRole('link', { name: /Télécharger le modèle vide/ })).toHaveAttribute('href', expect.stringContaining('annee=2026&mois=2'))
  await saisirLeMois()
  expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent('EMPLOYÉS CONCERNÉS — FÉVRIER 2026')

  // Cochés par défaut : les non saisis ; badges explicites.
  const ann = await screen.findByRole('checkbox', { name: /Ann/ })
  const bob = screen.getByRole('checkbox', { name: /Bob/ })
  expect(ann).toBeChecked()
  expect(bob).not.toBeChecked()
  expect(screen.getByText('Déjà saisi pour ce mois')).toBeInTheDocument()
  expect(screen.getByText('Absent en Janvier')).toBeInTheDocument()
  expect(screen.getByRole('list', { name: 'Étapes' })).toHaveTextContent('Employés concernés')
  // Un clic n'importe où sur la ligne coche l'employé.
  fireEvent.click(screen.getByRole('cell', { name: 'E2' }))
  expect(bob).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Tout décocher' }))
  fireEvent.click(screen.getByRole('button', { name: 'Tout cocher' }))
  expect(bob).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Continuer : saisir les montants (2) →' }))

  // Grille : matricule et nom en lecture seule, montants existants repris, collage d'un bloc Excel.
  const brutAnn = await screen.findByRole('textbox', { name: 'Brut Réel, Ann' })
  expect(screen.getByRole('textbox', { name: 'MATRICULE, Ann' })).toHaveAttribute('readonly')
  expect(screen.getByRole('textbox', { name: 'Brut Réel, Bob' })).toHaveValue('500')
  const coller = createEvent.paste(brutAnn, { clipboardData: { getData: () => '1 000\t2\r\n600\t\r\n' } })
  fireEvent(brutAnn, coller)
  expect(brutAnn).toHaveValue('1 000')
  expect(screen.getByRole('textbox', { name: 'Absences (nb), Ann' })).toHaveValue('2')
  expect(screen.getByRole('textbox', { name: 'Brut Réel, Bob' })).toHaveValue('600')

  // Vérification serveur différée puis enregistrement -> aperçu.
  const enregistrer = screen.getByRole('button', { name: 'Enregistrer…' })
  await waitFor(() => expect(enregistrer).toBeEnabled(), { timeout: 3000 })
  const verif = appels.filter((a) => a.url.includes('/verifier')).at(-1)!.corps as { lignes: { matricule: string; montants: Record<string, string | null> }[] }
  expect(verif.lignes.map((l) => [l.matricule, l.montants['Brut Réel']])).toEqual([['E1', '1 000'], ['E2', '600']])
  fireEvent.click(enregistrer)

  // Aperçu : synthèse employés / absents, puis la ligne existante de Bob est gardée telle quelle.
  expect(await screen.findByRole('region', { name: 'Employés' })).toHaveTextContent('oubli ou départ (présent le mois précédent, sans ligne ici)')
  // Oublis ou départs : prioritaires, ouverts d'office ; un seul volet ouvert à la fois.
  const oublis = screen.getByRole('button', { name: /^Oublis ou départs/ })
  expect(oublis).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(screen.getByRole('button', { name: /^Lignes à mettre à jour/ }))
  expect(oublis).toHaveAttribute('aria-expanded', 'false')
  const ligneBob = (await screen.findByRole('rowheader', { name: /Bob/ })).closest('tr')!
  expect(ligneBob).toHaveTextContent('500 → 600')
  fireEvent.click(within(ligneBob).getByRole('radio', { name: 'Garder' }))
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer 1 ligne' }))
  // Retour automatique sur la feuille DONNEES, qui confirme l'enregistrement.
  await screen.findByText(/Enregistré : 1 ligne/)
  expect(screen.getByRole('button', { name: 'Annuler cet enregistrement' })).toBeInTheDocument()
  const valider = appels.find((a) => a.url.includes('/valider'))!
  expect(valider.corps).toEqual({ garder: [{ annee: 2026, mois: 2, matricule: 'E2' }] })
  // Brouillon local effacé une fois enregistré.
  expect(localStorage.getItem('saisie:2026-02')).toBeNull()
})

test('données du mois : CA et marge saisis à plat, case vide calculée depuis les employés, corps du PUT', async () => {
  reponsePut = () => new Response(JSON.stringify({
    ...SAISIES_CA,
    periode_id: 4,
    niveau_enregistre: 'global',
    cases: [{ site_id: null, service_id: null, valeurs: {
      ca: { saisi: '1000000.000', employes: '800000.000', valeur: '1000000.000', origine: 'saisi', ecart: '200000.000' },
      marge: { saisi: '-50000.000', employes: null, valeur: '-50000.000', origine: 'saisi', ecart: null },
    } }],
    totaux: {
      ca: { valeur: '1000000.000', partiel: false, renseignes: 1, attendus: 1 },
      marge: { valeur: '-50000.000', partiel: false, renseignes: 1, attendus: 1 },
    },
    taux_marge: '-0.05',
  }))
  rendu()
  await ouvrirDonnees()
  expect(await screen.findByRole('heading', { name: 'DONNÉES — FÉVRIER 2026' })).toBeInTheDocument()
  expect(await screen.findByRole('tab', { name: 'CA et marge' })).toHaveAttribute('aria-selected', 'true')
  const ca = await screen.findByRole('textbox', { name: 'CA : Global' })
  const marge = screen.getByRole('textbox', { name: 'Marge : Global' })
  // Case vide : grise, valeur des employés en indication.
  expect(ca).toHaveValue('')
  expect(ca.getAttribute('placeholder')).toMatch(/^800\s000$/)
  expect(ca).toHaveAttribute('title', 'Somme des employés')
  expect(ca.closest('td')).toHaveClass('calcule')
  expect(marge.closest('td')).not.toHaveClass('calcule')
  expect(screen.getByRole('link', { name: 'Détail par employé' })).toHaveAttribute('href', '/admin')
  const enregistrer = screen.getByRole('button', { name: 'Enregistrer' })
  expect(enregistrer).toBeDisabled() // rien de modifié
  fireEvent.change(ca, { target: { value: '-1' } })
  expect(ca).toHaveAttribute('aria-invalid', 'true')
  expect(enregistrer).toBeDisabled()
  fireEvent.change(ca, { target: { value: '1 000 000' } })
  fireEvent.change(marge, { target: { value: '-50 000' } })
  fireEvent.click(enregistrer)
  await screen.findByText('Enregistré.')
  const envoi = appels.find((a) => a.url.includes('/pilotage/saisies') && a.corps)!
  expect(envoi.corps).toEqual({
    annee: 2026, mois: 2, groupe: 'ca_marge', niveau: 'global',
    cases: [{ site_id: null, service_id: null, valeurs: { ca: '1000000', marge: '-50000' } }],
  })
  // Champs remis au format affiché, taux et part non répartie donnés par le serveur.
  expect((screen.getByRole('textbox', { name: 'CA : Global' }) as HTMLInputElement).value).toMatch(/^1\s000\s000$/)
  expect(screen.getByText(/non réparti : 200\s000/)).toBeInTheDocument()
  expect(screen.getAllByText(/-5\s%/).length).toBeGreaterThan(0)
  expect(screen.queryByRole('tab', { name: 'Budgets' })).toBeNull()
  // Budgets : carte sur la page de départ, nombre saisi et total par axe.
  fireEvent.click(screen.getByRole('button', { name: 'Retour : Choix du mois' }))
  const services = (await screen.findByText('Services')).closest('li')!
  expect(services).toHaveTextContent(/1 sur 1/)
  expect(services).toHaveTextContent(/300\sFCFA/)
  expect(screen.getByRole('button', { name: 'Saisir les budgets de Février 2026 →' })).toBeInTheDocument()
})

test('changement de niveau : confirmation avant d’effacer les chiffres saisis, puis une ligne par site', async () => {
  reponsePut = (corps) => new Response(JSON.stringify({ ...SAISIES_CA, niveau: corps.niveau, niveau_enregistre: corps.niveau }))
  rendu()
  await ouvrirDonnees()
  const ca = await screen.findByRole('textbox', { name: 'CA : Global' })
  fireEvent.change(ca, { target: { value: '900000' } })
  fireEvent.click(screen.getByRole('radio', { name: 'Par site' }))
  const dialogue = screen.getByRole('dialog', { name: 'Changer de niveau de saisie ?' })
  expect(dialogue).toHaveTextContent('Les chiffres tapés et non enregistrés seront effacés.')
  // Annuler : on reste au niveau global, le chiffre tapé est gardé.
  fireEvent.click(within(dialogue).getByRole('button', { name: 'Annuler' }))
  expect(screen.getByRole('radio', { name: 'Global' })).toBeChecked()
  expect((screen.getByRole('textbox', { name: 'CA : Global' }) as HTMLInputElement).value).toMatch(/^900\s000$/)
  fireEvent.click(screen.getByRole('radio', { name: 'Par site' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Changer de niveau de saisie ?' })).getByRole('button', { name: 'Changer de niveau' }))
  expect(screen.getByRole('radio', { name: 'Par site' })).toBeChecked()
  // Le niveau choisi est demandé au serveur ; la grille par site arrive avec sa réponse.
  fireEvent.change(await screen.findByRole('textbox', { name: 'CA : Douala' }), { target: { value: '600 000' } })
  expect(appels.some((a) => a.url.includes('/pilotage/saisies') && a.url.includes('niveau=site'))).toBe(true)
  expect(screen.queryByRole('textbox', { name: 'CA : Global' })).toBeNull()
  expect(screen.getByRole('textbox', { name: 'CA : Yaoundé' })).toHaveValue('')
  // Total recalculé en local, incomplet tant qu'un site n'est pas renseigné.
  expect(within(screen.getByRole('row', { name: /TOTAL/ })).getByText('partiel (1 site sur 2)')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
  await screen.findByText('Enregistré.')
  const envoi = appels.find((a) => a.url.includes('/pilotage/saisies') && a.corps)!
  expect(envoi.corps).toEqual({
    annee: 2026, mois: 2, groupe: 'ca_marge', niveau: 'site',
    cases: [
      { site_id: 1, service_id: null, valeurs: { ca: '600000', marge: null } },
      { site_id: 2, service_id: null, valeurs: { ca: null, marge: null } },
    ],
  })
})

test('OR, devis, factures : total partiel, part non répartie, erreur du serveur affichée', async () => {
  reponsePut = () => new Response(JSON.stringify({ detail: 'Mois clos : saisie impossible.' }), { status: 409 })
  rendu()
  await ouvrirDonnees()
  fireEvent.click(await screen.findByRole('tab', { name: 'OR, devis, factures' }))
  expect(await screen.findByRole('textbox', { name: 'OR : Douala' })).toHaveValue('500')
  expect(screen.getByRole('radio', { name: 'Par site' })).toBeChecked()
  expect(screen.getByText(/non réparti : 20/)).toBeInTheDocument()
  const total = within(screen.getByRole('row', { name: /TOTAL/ }))
  expect(total.getAllByText('partiel (1 site sur 2)')).toHaveLength(2)
  expect(total.getByText('partiel (0 site sur 2)')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Factures : Yaoundé' }), { target: { value: '70' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Mois clos')
})

test('sans le droit marge : pas d’onglet CA et marge, on arrive sur l’activité', async () => {
  rendu(['import:read'])
  await ouvrirDonnees()
  await screen.findByRole('tab', { name: 'OR, devis, factures' })
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'OR : Douala' })).toBeInTheDocument())
  expect(screen.queryByRole('tab', { name: 'CA et marge' })).toBeNull()
  expect(screen.getByRole('tab', { name: 'OR, devis, factures' })).toHaveAttribute('aria-selected', 'true')
})

test('sans le droit de lecture des imports : seule la carte Budgets, aucune grille demandée', async () => {
  rendu([])
  await screen.findByRole('button', { name: 'Saisir les budgets de Février 2026 →' })
  expect(screen.queryByRole('button', { name: 'Saisir les données de Février 2026 →' })).toBeNull()
  expect(appels.some((a) => a.url.includes('/pilotage/saisies'))).toBe(false)
})

test('changement de niveau : la grille est pré-remplie par la proposition du serveur et la part à répartir est affichée', async () => {
  reponseGet = (url) => {
    const niveau = url.searchParams.get('niveau') ?? 'global'
    if (niveau === 'global') return { ...SAISIES_CA, niveau_enregistre: 'global', niveau_par_defaut: false }
    return {
      ...SAISIES_CA, niveau, niveau_enregistre: 'global', niveau_par_defaut: false,
      a_repartir: { marge: '50000.000' },
      cases: [{ site_id: 1, service_id: null, valeurs: { ca: { ...vierge, propose: '600000.000' }, marge: vierge } }],
    }
  }
  rendu()
  await ouvrirDonnees()
  await screen.findByRole('textbox', { name: 'CA : Global' })
  fireEvent.click(screen.getByRole('radio', { name: 'Par site' })) // rien de tapé : pas de confirmation
  const douala = await screen.findByRole('textbox', { name: 'CA : Douala' })
  expect((douala as HTMLInputElement).value).toMatch(/^600\s000$/)
  expect(screen.getByRole('textbox', { name: 'CA : Yaoundé' })).toHaveValue('')
  expect(screen.getByText(/À répartir : Marge 50\s000/)).toBeInTheDocument()
  // La proposition n'est pas enregistrée : le bouton est actif.
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled()
})

test('collage d’un bloc Excel, Entrée vers la case du dessous', async () => {
  rendu()
  await ouvrirDonnees()
  fireEvent.click(await screen.findByRole('tab', { name: 'OR, devis, factures' }))
  const orDouala = await screen.findByRole('textbox', { name: 'OR : Douala' })
  orDouala.focus()
  fireEvent.keyDown(orDouala, { key: 'Enter' })
  expect(screen.getByRole('textbox', { name: 'OR : Yaoundé' })).toHaveFocus()
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'OR : Yaoundé' }), { key: 'Enter', shiftKey: true })
  expect(orDouala).toHaveFocus()
  // Deux lignes, trois colonnes, milliers et virgule acceptés ; une ligne de trop est ignorée.
  const bloc = '10\t1 200,5\t30\n40\t50\t60\n70\t80\t90'
  fireEvent.paste(orDouala, { clipboardData: { getData: () => bloc } })
  expect((screen.getByRole('textbox', { name: 'Devis : Douala' }) as HTMLInputElement).value).toMatch(/^1\s200,5$/)
  expect(screen.getByRole('textbox', { name: 'Factures : Yaoundé' })).toHaveValue('60')
  expect(screen.getByText(/6 cases collées ; 1 ligne hors de la grille ignorée/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled()
})

test('validation identique au serveur : 12 décimales au plus, erreur visible sur la case', async () => {
  rendu()
  await ouvrirDonnees()
  fireEvent.click(await screen.findByRole('tab', { name: 'OR, devis, factures' }))
  const or = await screen.findByRole('textbox', { name: 'OR : Yaoundé' })
  fireEvent.change(or, { target: { value: '1,123456789012' } })
  expect(or).not.toHaveAttribute('aria-invalid')
  fireEvent.change(or, { target: { value: '1,1234567890123' } })
  expect(or).toHaveAttribute('aria-invalid', 'true')
  expect(or).toHaveAccessibleDescription('Valeur invalide')
  expect(screen.getByText(/1 valeur invalide :/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
  fireEvent.change(or, { target: { value: '1 234 567 890 123 456' } }) // 16 chiffres
  expect(or).toHaveAttribute('aria-invalid', 'true')
})

test('saisie en cours gardée au rechargement, alerte en quittant, confirmation en changeant de mois, Ctrl+S', async () => {
  reponsePut = (corps) => new Response(JSON.stringify({ ...SAISIES_ACTIVITE, niveau: corps.niveau }))
  let serveur = '500.000'
  reponseGet = () => ({
    ...SAISIES_ACTIVITE,
    cases: [{ ...SAISIES_ACTIVITE.cases[0], valeurs: { ...SAISIES_ACTIVITE.cases[0].valeurs, or: { ...vierge, saisi: serveur, valeur: serveur, origine: 'saisi' } } }, SAISIES_ACTIVITE.cases[1]],
  })
  const qc = rendu()
  await ouvrirDonnees()
  fireEvent.click(await screen.findByRole('tab', { name: 'OR, devis, factures' }))
  const yaounde = await screen.findByRole('textbox', { name: 'OR : Yaoundé' })
  const alerte = () => {
    const e = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e)
    return e.defaultPrevented
  }
  expect(alerte()).toBe(false)
  fireEvent.change(yaounde, { target: { value: '70' } })
  expect(alerte()).toBe(true)
  // Rechargement : la case tapée reste, la case intacte reprend la valeur du serveur.
  serveur = '900.000'
  await act(async () => { await qc.invalidateQueries({ queryKey: ['saisies'] }) })
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'OR : Douala' })).toHaveValue('900'))
  expect(screen.getByRole('textbox', { name: 'OR : Yaoundé' })).toHaveValue('70')
  // Revenir au choix du mois : confirmation, annuler garde la saisie.
  fireEvent.click(screen.getByRole('button', { name: 'Retour : Choix du mois' }))
  const dialogue = screen.getByRole('dialog', { name: 'Quitter sans enregistrer ?' })
  fireEvent.click(within(dialogue).getByRole('button', { name: 'Annuler' }))
  expect(screen.getByRole('heading', { name: 'DONNÉES — FÉVRIER 2026' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'OR : Yaoundé' })).toHaveValue('70')
  // Ctrl+S enregistre.
  fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  await screen.findByText('Enregistré.')
  expect(appels.some((a) => a.url.includes('/pilotage/saisies') && a.corps)).toBe(true)
  expect(alerte()).toBe(false)
})

test('erreur signalée par le serveur : cellule en rouge, message, enregistrement bloqué', async () => {
  anomalies = [{ ligne: 0, colonne: 'Brut Réel', code: 'NON_NUMERIQUE', gravite: 'bloquant', message: 'Nombre attendu' }]
  rendu()
  await saisirLeMois()
  fireEvent.click(await screen.findByRole('button', { name: 'Continuer : saisir les montants (1) →' }))
  const brut = await screen.findByRole('textbox', { name: 'Brut Réel, Ann' })
  fireEvent.change(brut, { target: { value: '12 FCFA' } })
  expect(brut.closest('td')).toHaveClass('ko') // contrôle local immédiat
  await screen.findByText(/1 erreur à corriger/, undefined, { timeout: 3000 })
  expect(screen.getByRole('button', { name: 'Enregistrer…' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Aller à la première' }))
  expect(brut).toHaveFocus()
  expect(screen.getByText('Nombre attendu')).toBeInTheDocument()
  anomalies = []
})

test('vérification serveur en échec : message, enregistrement bloqué', async () => {
  rendu()
  const fetchMock = vi.mocked(globalThis.fetch)
  const normal = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (u, init) =>
    String(u).includes('/verifier') ? new Response('{"detail":"Trop de lignes"}', { status: 422 }) : normal(u, init))
  await saisirLeMois()
  fireEvent.click(await screen.findByRole('button', { name: 'Continuer : saisir les montants (1) →' }))
  fireEvent.change(await screen.findByRole('textbox', { name: 'Brut Réel, Ann' }), { target: { value: '100' } })
  await screen.findByText(/Vérification impossible/, undefined, { timeout: 3000 })
  expect(screen.getByRole('button', { name: 'Enregistrer…' })).toBeDisabled()
})

test('grille triée et filtrée : saisie et collage portent sur les lignes affichées', async () => {
  rendu()
  await saisirLeMois()
  fireEvent.click(await screen.findByRole('button', { name: 'Tout cocher' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continuer : saisir les montants (2) →' }))
  await screen.findByRole('textbox', { name: 'Brut Réel, Ann' })
  const ordre = () => screen.getAllByRole('textbox', { name: /^Brut Réel, / }).map((e) => e.getAttribute('aria-label'))

  // Tri décroissant sur le nom : Bob puis Ann.
  const noms = screen.getByRole('columnheader', { name: 'Noms' })
  fireEvent.click(within(noms).getByRole('button'))
  fireEvent.click(within(noms).getByRole('button'))
  expect(noms).toHaveAttribute('aria-sort', 'descending')
  expect(ordre()).toEqual(['Brut Réel, Bob', 'Brut Réel, Ann'])

  // Recherche : Ann seule ; un collage de deux lignes remplit Ann puis crée une ligne, Bob intact.
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ann' } })
  expect(ordre()).toEqual(['Brut Réel, Ann'])
  expect(screen.getByText('1 ligne affichée sur 2')).toBeInTheDocument()
  const brutAnn = screen.getByRole('textbox', { name: 'Brut Réel, Ann' })
  fireEvent(brutAnn, createEvent.paste(brutAnn, { clipboardData: { getData: () => '7\n8\n' } }))
  expect(brutAnn).toHaveValue('7')
  expect(ordre()).toEqual(['Brut Réel, Ann', 'Brut Réel, ligne 2'])
  fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser les filtres' }))
  expect(screen.getByRole('textbox', { name: 'Brut Réel, Bob' })).toHaveValue('500')
  expect(screen.getByRole('textbox', { name: 'Brut Réel, ligne 3' })).toHaveValue('8')
})

test('modèle Excel calqué sur la sélection et la saisie ; liste de valeurs de la grille au clavier', async () => {
  URL.createObjectURL = vi.fn(() => 'blob:modele')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  rendu()
  await saisirLeMois()
  const modele = () => appels.filter((a) => a.url.endsWith('/donnees/modele.xlsx')).at(-1)?.corps as { lignes: { matricule: string }[] }

  // Personne de coché : modèle vide.
  fireEvent.click(await screen.findByRole('button', { name: 'Tout décocher' }))
  fireEvent.click(screen.getByRole('button', { name: /Télécharger un modèle prérempli/ }))
  await waitFor(() => expect(modele()).toEqual({ annee: 2026, mois: 2, lignes: [] }))
  // Modèle téléchargé, rien de changé : le lien propose d'importer le fichier rempli.
  expect(await screen.findByRole('button', { name: 'Importer le fichier rempli (.xlsx)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Continuer : saisir les montants (0) →' })).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: 'Tout cocher' }))
  expect(screen.queryByRole('button', { name: 'Importer le fichier rempli (.xlsx)' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Continuer : saisir les montants (2) →' }))
  const site = await screen.findByRole('combobox', { name: 'Site, Ann' })

  // Frappe : valeurs connues correspondantes ; flèche puis Entrée retient la valeur.
  fireEvent.change(site, { target: { value: 'dou' } })
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Douala'])
  expect(site).toHaveAttribute('aria-expanded', 'true')
  fireEvent.keyDown(site, { key: 'ArrowDown' })
  expect(site).toHaveAttribute('aria-activedescendant', within(screen.getByRole('listbox')).getByRole('option').id)
  fireEvent.keyDown(site, { key: 'Enter' })
  expect(site).toHaveValue('Douala')
  expect(screen.queryByRole('listbox')).toBeNull()

  // Le modèle de la grille reprend les lignes et les valeurs tapées.
  fireEvent.change(screen.getByRole('textbox', { name: 'Brut Réel, Ann' }), { target: { value: '1200' } })
  fireEvent.click(screen.getByRole('button', { name: /Télécharger un modèle prérempli/ }))
  await waitFor(() => expect(modele().lignes.map((l) => l.matricule)).toEqual(['E1', 'E2']))
  expect(modele().lignes[0]).toMatchObject({ site: 'Douala', montants: { 'Brut Réel': '1200' } })
})

test('plusieurs mois : modèle vide sans date, saisie dans l’application réservée à un mois précis', async () => {
  rendu()
  await waitFor(() => expect(screen.getByLabelText('Mois')).toHaveValue('2'))
  fireEvent.change(screen.getByLabelText('Mois'), { target: { value: '0' } })
  expect(screen.getByLabelText('Année')).toBeDisabled()
  const lien = screen.getByRole('link', { name: /Télécharger le modèle vide/ })
  expect(lien.getAttribute('href')).toMatch(/modele\.xlsx\?$/)
  expect(screen.queryByRole('button', { name: /Étape 1/ })).toBeNull()
  expect(screen.getByText('Choisissez un mois précis pour saisir dans l’application.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'DONNÉES DU MOIS' })).toBeInTheDocument()
  expect(screen.getByText('Choisissez un mois précis pour saisir ces chiffres.')).toBeInTheDocument()
  expect(screen.getByText('Choisissez un mois précis pour saisir les budgets.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Enregistrer|Saisir les budgets/ })).toBeNull()
})

test('nouvel employé : ajouté depuis le choix des employés, matricule unique, repris dans la grille', async () => {
  rendu()
  await saisirLeMois()
  fireEvent.click(await screen.findByRole('button', { name: '+ Nouvel employé' }))
  const fiche = screen.getByRole('form', { name: 'Nouvel employé' })
  fireEvent.change(within(fiche).getByLabelText('MATRICULE'), { target: { value: 'e1' } })
  fireEvent.change(within(fiche).getByLabelText('Noms'), { target: { value: 'Cléo' } })
  fireEvent.click(within(fiche).getByRole('button', { name: 'Ajouter' }))
  expect(screen.getByRole('alert')).toHaveTextContent('existe déjà')
  fireEvent.change(within(fiche).getByLabelText('MATRICULE'), { target: { value: 'E3' } })
  fireEvent.change(within(fiche).getByLabelText('Site'), { target: { value: 'Douala' } })
  fireEvent.click(within(fiche).getByRole('button', { name: 'Ajouter' }))
  expect(screen.queryByRole('form', { name: 'Nouvel employé' })).toBeNull()
  expect(screen.getByRole('rowgroup', { name: 'Nouveaux employés' })).toHaveTextContent('Cléo')
  fireEvent.click(screen.getByRole('button', { name: 'Continuer : saisir les montants (2) →' }))
  expect(await screen.findByRole('textbox', { name: 'Brut Réel, Cléo' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Site, Cléo' })).toHaveValue('Douala')
  expect(screen.queryByRole('button', { name: /Ajouter une ligne/ })).toBeNull()
})
