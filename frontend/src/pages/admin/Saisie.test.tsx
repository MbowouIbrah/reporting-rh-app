import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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

const appels: { url: string; corps?: unknown }[] = []
let anomalies: unknown[] = []
function rendu() {
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
    if (url.includes('/pilotage/ca-marge')) return new Response(JSON.stringify({ ...PILOTAGE, periode_id: 4, ca: '1000000.000', marge: '-50000.000', taux_marge: '-0.05' }))
    if (url.includes('/pilotage')) return new Response(JSON.stringify(PILOTAGE))
    return new Response('{}')
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/saisie']}>
        <Routes>
          <Route path="/admin/saisie" element={<Saisie />} />
          <Route path="/admin" element={<BandeauEnregistre />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const saisirLeMois = async () => fireEvent.click(await screen.findByRole('button', { name: 'Étape 1 : choisir les employés de Février 2026 →' }))
afterEach(() => vi.restoreAllMocks())

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

test('pilotage du mois : CA et marge saisis ensemble, résumé des budgets', async () => {
  rendu()
  expect(await screen.findByRole('heading', { name: 'PILOTAGE DE FÉVRIER 2026' })).toBeInTheDocument()
  const ca = await screen.findByRole('textbox', { name: 'Chiffre d’affaires' })
  const marge = screen.getByRole('textbox', { name: 'Marge' })
  const enregistrer = screen.getByRole('button', { name: 'Enregistrer le CA et la marge' })
  expect(enregistrer).toBeDisabled() // rien de modifié
  // Marge sans CA : refusée avant tout envoi.
  fireEvent.change(marge, { target: { value: '-50 000' } })
  expect(screen.getByText('Saisissez le CA du mois avant la marge.')).toBeInTheDocument()
  expect(enregistrer).toBeDisabled()
  fireEvent.change(ca, { target: { value: '-1' } })
  expect(screen.getByText(/Le CA ne peut pas être négatif/)).toBeInTheDocument()
  fireEvent.change(ca, { target: { value: '1 000 000' } })
  fireEvent.click(enregistrer)
  await screen.findByText('Enregistré.')
  const envoi = appels.find((a) => a.url.includes('/pilotage/ca-marge'))!
  expect(envoi.corps).toEqual({ annee: 2026, mois: 2, ca: '1000000', marge: '-50000' })
  // Taux calculé par le serveur ; champs remis au format affiché.
  expect(screen.getByText('Taux de marge enregistré').nextSibling).toHaveTextContent(/-5,0\s%/)
  expect(ca).toHaveValue('1 000 000')
  // Budgets : nombre saisi et total par axe.
  const services = screen.getByText('Services').closest('li')!
  expect(services).toHaveTextContent(/1 sur 1/)
  expect(services).toHaveTextContent(/300\sFCFA/)
  expect(screen.getByRole('button', { name: 'Saisir les budgets de Février 2026 →' })).toBeInTheDocument()
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
  expect(screen.getByRole('heading', { name: 'PILOTAGE DU MOIS' })).toBeInTheDocument()
  expect(screen.getByText('Choisissez un mois précis pour saisir le CA et la marge.')).toBeInTheDocument()
  expect(screen.getByText('Choisissez un mois précis pour saisir les budgets.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Enregistrer le CA|Saisir les budgets/ })).toBeNull()
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
