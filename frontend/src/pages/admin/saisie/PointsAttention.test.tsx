import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { vi } from 'vitest'
import * as saisie from '../../../api/saisie'
import type { AnomalieLot } from '../../../api/saisie'
import PointsAttention, { repartir, VOLET_ERREURS } from './PointsAttention'

function anomalie(code: string, gravite: AnomalieLot['gravite'] = 'avertissement', message = code, colonne = 'Noms'): AnomalieLot {
  return { ligne: 4, colonne, code, gravite, valeur: 'Jhon', message, matricule: 'EMP004', nom: 'John Doe' }
}

test('repartir : à corriger, à confirmer puis corrigé auto ; code inconnu dans « Montants et référentiels »', () => {
  const groupes = repartir([anomalie('NORMALISE'), anomalie('POSTE_NOUVEAU'), anomalie('INCONNU'),
    anomalie('NOM_SIMILAIRE'), anomalie('NOM_PROCHE'), anomalie('DOUBLON', 'bloquant')])
  expect(groupes.map((g) => [g.titre, g.lignes.length])).toEqual([
    ['Erreurs à corriger', 1],
    ['Noms et matricules à vérifier', 2],
    ['Montants et référentiels', 2],
    ['Valeurs corrigées automatiquement', 1],
  ])
})

function Volets({ anomalies, afficherLigne = true, lotId }: { anomalies: AnomalieLot[]; afficherLigne?: boolean; lotId?: number }) {
  const [ouvert, setOuvert] = useState<string>(VOLET_ERREURS)
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PointsAttention anomalies={anomalies} lotId={lotId} afficherLigne={afficherLigne} ouvert={ouvert} onOuvrir={setOuvert} />
    </QueryClientProvider>
  )
}

test('niveaux, employé nommé, un seul volet ouvert à la fois', () => {
  render(
    <Volets
      anomalies={[
        anomalie('NOM_HOMONYME', 'bloquant', 'Nom porté par plusieurs employés'),
        anomalie('NOM_PROCHE', 'avertissement', 'Proche de John (E1)'),
        anomalie('NORMALISE', 'avertissement', 'Espaces retirés'),
      ]}
    />,
  )
  const erreurs = screen.getByRole('button', { name: /^Erreurs à corriger/ })
  const noms = screen.getByRole('button', { name: /^Noms et matricules à vérifier/ })
  expect(erreurs).toHaveTextContent('À corriger')
  expect(noms).toHaveTextContent('À confirmer')
  expect(screen.getByRole('button', { name: /^Valeurs corrigées automatiquement/ })).toHaveAttribute('aria-expanded', 'false')

  expect(erreurs).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('row', { name: /4 EMP004 · John Doe Noms Jhon Nom porté par plusieurs employés/ })).toBeInTheDocument()

  fireEvent.click(noms)
  expect(erreurs).toHaveAttribute('aria-expanded', 'false')
  expect(noms).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('columnheader', { name: 'Valeur' })).toBeInTheDocument()
  expect(screen.getByText('Proche de John (E1)')).toBeInTheDocument()

  // Comme le compte rendu : cliquer le volet ouvert le laisse ouvert.
  fireEvent.click(noms)
  expect(noms).toHaveAttribute('aria-expanded', 'true')
})

test('la ligne se déplie comme le détail par contrat, cellule en cause surlignée', async () => {
  vi.spyOn(saisie, 'lireLigne').mockResolvedValue({
    ligne: 4, annee: 2026, mois: 8, matricule: 'EMP004', nom: 'John Doe', poste: 'Vendeur', type_contrat: 'CDI',
    activite: 'VN', site: null, service: 'SAV PL', montants: { Bonus: '1000' },
  })
  render(<Volets lotId={7} anomalies={[anomalie('REFERENTIEL_INCONNU', 'bloquant', 'Valeur inconnue.', 'Site')]} />)
  const deplier = screen.getByRole('button', { name: 'Détail de la ligne 4' })
  expect(deplier).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(screen.getByText('Valeur inconnue.'))
  expect(deplier).toHaveAttribute('aria-expanded', 'true')
  expect(await screen.findByRole('row', { name: /^MOIS Août/ })).toBeInTheDocument()
  expect(screen.getByRole('rowheader', { name: 'Détail de la ligne 4 du fichier' })).toBeInTheDocument()
  expect(saisie.lireLigne).toHaveBeenCalledWith(7, 4)
  const site = screen.getByRole('row', { name: /^Site Jhon/ })
  expect(site.querySelectorAll('td')[1]).toHaveClass('cellule-ko', 'cellule-cible')
  fireEvent.click(deplier)
  expect(screen.queryByRole('row', { name: /^MOIS Août/ })).toBeNull()
})

test('saisie en grille : pas de colonne Ligne', () => {
  render(<Volets afficherLigne={false} anomalies={[anomalie('MUTATION')]} />)
  expect(screen.queryByRole('columnheader', { name: 'Ligne' })).toBeNull()
  expect(screen.getByText('Changements d’affectation')).toBeInTheDocument()
})
