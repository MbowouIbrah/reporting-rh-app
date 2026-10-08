import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../../auth/AuthContext'
import RequireAuth from '../../auth/RequireAuth'
import Donnees from './Donnees'

const RUBRIQUES = ['Absences (nb)', 'Brut Réel']
const TABLEAU = {
  colonnes: RUBRIQUES,
  filtres: { annees: [2026], services: ['SAV PL'], sites: ['Douala'] },
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

test('reproduit les en-têtes de DONNEES dans l’ordre, avec titre et consigne', async () => {
  appels = rendu(['saisie:write'])
  await screen.findByRole('cell', { name: 'Février' })
  const entetes = screen.getAllByRole('columnheader').map((th) => th.textContent)
  expect(entetes).toEqual([
    'ANNÉE', 'MOIS', 'MATRICULE', 'Noms', 'Poste', 'Type Contrat', 'Activité', 'Site', 'Service',
    ...RUBRIQUES, 'TOTAL CHARGES (FCFA)', 'Total exclusions (technique)',
  ])
  expect(screen.getByRole('heading', { name: /FEUILLE DE DONNÉES CENTRALE/ })).toBeInTheDocument()
  expect(screen.getByText(/^Saisir ANNÉE \(ex\. 2025\)/)).toBeInTheDocument()
  const cellules = screen.getAllByRole('cell').map((td) => td.textContent)
  expect(cellules[9]).toBe('') // Absences non saisies : cellule vide
  expect(cellules[10]).toBe('1 000,5')
})

test('un filtre part dans la requête, Réinitialiser les retire tous', async () => {
  appels = rendu(['saisie:write'], '/admin?service=SAV+PL')
  await screen.findByRole('cell', { name: 'Février' })
  expect(tableau().at(-1)).toContain('service=SAV+PL')
  fireEvent.change(screen.getByLabelText('Mois'), { target: { value: '2' } })
  await waitFor(() => expect(tableau().at(-1)).toMatch(/mois=2/))
  fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }))
  await waitFor(() => expect(tableau().at(-1)).toMatch(/\/donnees\/tableau\?$/))
  expect(screen.getByRole('button', { name: 'Réinitialiser' })).toBeDisabled()
})

test('sans droit de saisie : accès refusé', async () => {
  appels = rendu([])
  expect(await screen.findByRole('alert')).toHaveTextContent('Accès refusé')
  expect(tableau()).toHaveLength(0)
})
