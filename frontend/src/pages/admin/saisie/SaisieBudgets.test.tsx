import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Pilotage } from '../../../api/pilotage'
import SaisieBudgets from './SaisieBudgets'

const cible = (cible_id: number, libelle: string, exclue = false, valeur: string | null = null) =>
  ({ cible_id, libelle, actif: true, exclue, valeur })
const VUE: Pilotage = {
  annee: 2026, mois: 2, periode_id: null, ca: null, marge: null, taux_marge: null,
  budgets: {
    rubrique: [cible(1, 'Brut Réel'), cible(2, 'Primes sur ventes', true), cible(3, 'Transport')],
    service: [cible(1, 'SAV PL')],
    site: [cible(1, 'Douala')],
  },
  totaux: { rubrique: null, service: null, site: null },
  reprise: { annee: 2026, mois: 1, valeurs: { rubrique: { '1': '1000.000', '2': '50.000' }, service: {}, site: { '1': '2500000.000' } } },
}

let corps: unknown
function rendu(onRetour = vi.fn()) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
    corps = JSON.parse(String(init!.body))
    return new Response(JSON.stringify({ ...VUE, periode_id: 4, reprise: null }))
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SaisieBudgets vue={VUE} periode="Février 2026" onRetour={onRetour} />
    </QueryClientProvider>,
  )
  return onRetour
}
afterEach(() => vi.restoreAllMocks())

const table = (nom: RegExp) => screen.getByRole('table', { name: nom })
const total = (t: HTMLElement) => within(t).getByRole('rowheader', { name: 'TOTAL' }).nextElementSibling

test('reprise du mois précédent en pré-remplissage, exclues hors total, envoi des seuls changements', async () => {
  rendu()
  const rub = table(/types de charge/)
  // Rubrique exclue en fin de tableau, mentionnée hors total.
  const lignes = within(rub).getAllByRole('rowheader').map((h) => h.textContent)
  expect(lignes).toEqual(['Brut Réel', 'Transport', 'Primes sur venteshors total', 'TOTAL'])
  expect(total(rub)).toHaveTextContent('—')

  fireEvent.click(screen.getByRole('button', { name: 'Reprendre les budgets de Janvier' }))
  expect(screen.getByRole('textbox', { name: 'Budget Brut Réel (types de charge)' })).toHaveValue('1 000')
  expect(total(rub)).toHaveTextContent(/^1\s000$/) // 50 de l'exclue hors total
  expect(total(table(/sites/))).toHaveTextContent(/2\s500\s000/)
  expect(screen.queryByRole('button', { name: /Reprendre/ })).toBeNull()
  expect(screen.getByText('3 budgets modifiés, non enregistrés.')).toBeInTheDocument()

  // Montant invalide : cellule en rouge, enregistrement bloqué.
  const transport = screen.getByRole('textbox', { name: 'Budget Transport (types de charge)' })
  fireEvent.change(transport, { target: { value: '12 FCFA' } })
  expect(transport.closest('td')).toHaveClass('ko')
  expect(total(rub)).toHaveTextContent('—') // total inconnu, pas faux
  const enregistrer = screen.getByRole('button', { name: 'Enregistrer les budgets' })
  expect(enregistrer).toBeDisabled()
  fireEvent.change(transport, { target: { value: '2 000,5' } })
  expect(total(rub)).toHaveTextContent(/^3\s001$/)

  fireEvent.click(enregistrer)
  await screen.findByText('Budgets enregistrés.')
  expect(corps).toEqual({
    annee: 2026, mois: 2,
    lignes: [
      { axe: 'rubrique', cible_id: 1, valeur: '1000' },
      { axe: 'rubrique', cible_id: 2, valeur: '50' },
      { axe: 'rubrique', cible_id: 3, valeur: '2000,5' },
      { axe: 'site', cible_id: 1, valeur: '2500000' },
    ],
  })
})

test('retour avec des changements non enregistrés : confirmation', () => {
  const onRetour = rendu()
  fireEvent.click(screen.getByRole('button', { name: 'Retour : Choix du mois' }))
  expect(onRetour).toHaveBeenCalledTimes(1) // rien de modifié : retour direct
  fireEvent.change(screen.getByRole('textbox', { name: 'Budget SAV PL (services)' }), { target: { value: '10' } })
  fireEvent.click(screen.getByRole('button', { name: 'Retour : Choix du mois' }))
  expect(onRetour).toHaveBeenCalledTimes(1)
  const dialogue = screen.getByRole('dialog', { name: 'Quitter sans enregistrer ?' })
  expect(dialogue).toHaveTextContent('1 budget modifié sera perdu.')
  fireEvent.click(within(dialogue).getByRole('button', { name: 'Quitter' }))
  expect(onRetour).toHaveBeenCalledTimes(2)
})
