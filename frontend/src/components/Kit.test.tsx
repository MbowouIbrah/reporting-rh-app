import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import Etat from './Etat'
import { Badge, Section } from './Kit'
import Tuile, { Variation } from './Tuile'

test('Variation : flèche, signe et texte, pas la couleur seule', () => {
  const { container } = render(<Variation v="-0.05" />)
  expect(container).toHaveTextContent('▼')
  expect(container).toHaveTextContent('-5 % vs M-1')
  expect(container).toHaveTextContent('(baisse)')
  expect(container.querySelector('.neg')).not.toBeNull()
})

test('Variation positive : signe +', () => {
  const { container } = render(<Variation v="0.1" />)
  expect(container).toHaveTextContent('+10 %')
})

test('Tuile vide : explication de l’absence', () => {
  render(<Tuile titre="Marge" valeur="—" absence="CA non saisi" />)
  expect(screen.getByText('CA non saisi')).toBeInTheDocument()
})

test('Etat erreur : action Réessayer', () => {
  const retry = vi.fn()
  render(<Etat type="erreur" onRetry={retry} />)
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
  expect(retry).toHaveBeenCalled()
})

test('Etat 403 : texte d’aide distinct', () => {
  render(<Etat type="403" />)
  expect(screen.getByRole('alert')).toHaveTextContent('Votre rôle ne donne pas accès')
})

test('Section repliable et Badge', () => {
  const { container } = render(
    <Section titre="Effectifs" ouverte={false}>
      <Badge ton="succes">OK</Badge>
    </Section>,
  )
  expect(container.querySelector('details')).not.toHaveAttribute('open')
  expect(screen.getByText('Effectifs')).toBeInTheDocument()
})
