import { fireEvent, render, screen } from '@testing-library/react'
import Login from './Login'

test('affiche le formulaire et refuse un envoi vide', () => {
  render(<Login />)
  expect(screen.getByRole('heading', { name: /Reporting RH/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Renseignez')
})
