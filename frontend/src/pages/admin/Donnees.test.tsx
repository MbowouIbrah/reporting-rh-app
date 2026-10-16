import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../../auth/AuthContext'
import RequireAuth from '../../auth/RequireAuth'
import Donnees from './Donnees'

const RUBRIQUES = ['Absences (nb)', 'Brut Réel']
const TABLEAU = {
  colonnes: RUBRIQUES,
  exclues: ['Absences (nb)'],
  filtres: {
    annees: [2026], services: ['SAV PL'], sites: ['Douala'],
    salaries: [{ matricule: 'E1', nom: 'Ann' }, { matricule: 'E2', nom: 'Bob' }, { matricule: 'E3', nom: 'Élodie' }],
  },
  lignes: [
    {
      annee: 2026, mois: 2, matricule: 'E1', nom: 'Ann', poste: null, type_contrat: 'CDI', activite: 'SAV',
      site: 'Douala', service: 'SAV PL', montants: { 'Brut Réel': '1000.500' }, total: '1000.500', exclusions: '0.000',
    },
  ],
}

function rendu(perms: string[], chemin = '/admin') {
  const appels: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => {
    const url = String(u)
    appels.push(url)
    const corps = url.includes('/auth/me') ? { id: 1, email: 'a@b.c', roles: [], permissions: perms } : TABLEAU
    return new Response(JSON.stringify(corps))
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter initialEntries={[chemin]}>
          <Routes>
            <Route path="/admin" element={<RequireAuth perm="saisie:write"><Donnees /></RequireAuth>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return appels
}

const tableau = () => appels.filter((u) => u.includes('/donnees/tableau'))
let appels: string[] = []
afterEach(() => vi.restoreAllMocks())

test('en-têtes de DONNEES, rubriques exclues regroupées juste avant le TOTAL', async () => {
  appels = rendu(['saisie:write'])
  await screen.findByRole('cell', { name: 'Février' })
  const entetes = screen.getAllByRole('columnheader').map((th) => th.textContent)
  expect(entetes).toEqual([
    'ANNÉE', 'MOIS', 'MATRICULE', 'Noms', 'Poste', 'Type Contrat', 'Activité', 'Site', 'Service',
    'Brut Réel', 'Absences (nb) (exclu)', 'Total des colonnes exclues', 'TOTAL CHARGES (FCFA)',
  ])
  expect(screen.getByRole('heading', { name: /ADMINISTRATION DES DONNÉES/ })).toBeInTheDocument()
  expect(screen.getByText(/^Saisir ANNÉE \(ex\. 2025\)/)).toBeInTheDocument()
  const cellules = screen.getAllByRole('cell')
  expect(cellules[9].textContent).toMatch(/^1\s000,5$/)
  expect(cellules[10].textContent).toBe('') // Absences non saisies : cellule vide
  expect(cellules[10]).toHaveClass('exclu')
  expect(cellules.slice(0, 4).every((c) => c.classList.contains('fige'))).toBe(true)
  expect(cellules[4]).not.toHaveClass('fige')
})

test('Employé : liste triée avec « Tous », recherche par nom ou matricule, sans accents', async () => {
  appels = rendu(['saisie:write'])
  await screen.findByRole('cell', { name: 'Février' })
  const champ = screen.getByRole('combobox', { name: 'Employé' })
  expect(champ).toHaveValue('Tous')
  fireEvent.focus(champ)
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Tous', 'AnnE1', 'BobE2', 'ÉlodieE3'])
  fireEvent.change(champ, { target: { value: 'elo' } })
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['ÉlodieE3'])
  fireEvent.change(champ, { target: { value: 'e2' } })
  fireEvent.keyDown(champ, { key: 'Enter' })
  await waitFor(() => expect(tableau().at(-1)).toMatch(/matricule=E2/))
  expect(champ).toHaveValue('Bob (E2)')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('Employé : Échap referme la liste sans changer le filtre', async () => {
  appels = rendu(['saisie:write'], '/admin?matricule=E1')
  await screen.findByRole('cell', { name: 'Février' })
  const champ = screen.getByRole('combobox', { name: 'Employé' })
  expect(champ).toHaveValue('Ann (E1)')
  fireEvent.focus(champ)
  fireEvent.change(champ, { target: { value: 'bo' } })
  fireEvent.keyDown(champ, { key: 'Escape' })
  expect(champ).toHaveValue('Ann (E1)')
  expect(tableau().every((u) => u.includes('matricule=E1'))).toBe(true)
})

test('un filtre part dans la requête, Réinitialiser les retire tous', async () => {
  appels = rendu(['saisie:write'], '/admin?service=SAV+PL')
  await screen.findByRole('cell', { name: 'Février' })
  expect(tableau().at(-1)).toContain('service=SAV+PL')
  fireEvent.change(screen.getByLabelText('Mois'), { target: { value: '2' } })
  await waitFor(() => expect(tableau().at(-1)).toMatch(/mois=2/))
  fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser les filtres' }))
  await waitFor(() => expect(tableau().at(-1)).toMatch(/\/donnees\/tableau\?$/))
  // Toujours à sa place, inactif quand plus rien n'est filtré.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Réinitialiser les filtres' })).toBeDisabled())
})

test('sans droit de saisie : accès refusé', async () => {
  appels = rendu([])
  expect(await screen.findByRole('alert')).toHaveTextContent('Accès refusé')
  expect(tableau()).toHaveLength(0)
})
