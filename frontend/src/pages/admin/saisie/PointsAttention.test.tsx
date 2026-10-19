import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import type { AnomalieLot } from '../../../api/saisie'
import PointsAttention, { repartir, VOLET_ERREURS } from './PointsAttention'

function anomalie(code: string, gravite: AnomalieLot['gravite'] = 'avertissement', message = code): AnomalieLot {
  return { ligne: 4, colonne: 'NOM', code, gravite, valeur: 'Jhon', message }
}

test('repartir : groupes dans l’ordre, codes inconnus dans « Autres points », groupes vides omis', () => {
  const groupes = repartir([anomalie('POSTE_NOUVEAU'), anomalie('INCONNU'), anomalie('NOM_SIMILAIRE'), anomalie('NOM_PROCHE')])
  expect(groupes.map((g) => [g.titre, g.lignes.length])).toEqual([
    ['Noms à vérifier', 2],
    ['Montants et référentiels', 1],
    ['Autres points', 1],
  ])
})

function Volets({ anomalies, afficherLigne = true }: { anomalies: AnomalieLot[]; afficherLigne?: boolean }) {
  const [ouvert, setOuvert] = useState<string>(VOLET_ERREURS)
  return <PointsAttention anomalies={anomalies} afficherLigne={afficherLigne} ouvert={ouvert} onOuvrir={setOuvert} />
}

test('erreurs bloquantes à part avec la valeur ; un seul volet ouvert à la fois', () => {
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
  const noms = screen.getByRole('button', { name: /^Noms à vérifier/ })
  expect(screen.getByRole('button', { name: /^Valeurs corrigées automatiquement/ })).toHaveAttribute('aria-expanded', 'false')

  expect(erreurs).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('columnheader', { name: 'Valeur' })).toBeInTheDocument()
  expect(screen.getByRole('row', { name: /4 NOM Jhon Nom porté par plusieurs employés/ })).toBeInTheDocument()

  fireEvent.click(noms)
  expect(erreurs).toHaveAttribute('aria-expanded', 'false')
  expect(noms).toHaveAttribute('aria-expanded', 'true')
  expect(screen.queryByRole('columnheader', { name: 'Valeur' })).toBeNull()
  expect(screen.getByText('Proche de John (E1)')).toBeInTheDocument()

  // Comme le compte rendu : cliquer le volet ouvert le laisse ouvert.
  fireEvent.click(noms)
  expect(noms).toHaveAttribute('aria-expanded', 'true')
})

test('saisie en grille : pas de colonne Ligne', () => {
  render(<Volets afficherLigne={false} anomalies={[anomalie('MUTATION')]} />)
  expect(screen.queryByRole('columnheader', { name: 'Ligne' })).toBeNull()
  expect(screen.getByText('Changements d’affectation')).toBeInTheDocument()
})
