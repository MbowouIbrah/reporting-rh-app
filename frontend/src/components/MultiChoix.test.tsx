import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import MultiChoix from './MultiChoix'

function Banc({ depart = '', options = ['Douala', 'Kribi', 'Limbé'] }: { depart?: string; options?: string[] }) {
  const [v, setV] = useState(depart)
  return (
    <>
      <MultiChoix libelle="Site" pluriel="sites" options={options} valeur={v} onChange={setV} />
      <output>{v}</output>
    </>
  )
}

test('à la manière d’Excel : tout coché par défaut, valeur jointe par « | », tout sélectionner / désélectionner', () => {
  render(<Banc />)
  const bouton = screen.getByRole('button', { name: 'Site Tous' })
  fireEvent.click(bouton)
  const cases = () => screen.getAllByRole('checkbox') as HTMLInputElement[]
  expect(cases().every((c) => c.checked)).toBe(true)
  expect(screen.getByRole('button', { name: 'Tout sélectionner' })).toBeDisabled()
  // décocher une valeur garde les autres, dans l'ordre des options
  fireEvent.click(screen.getByRole('checkbox', { name: 'Kribi' }))
  expect(screen.getByRole('status')).toHaveTextContent(/^Douala\|Limbé$/)
  expect(bouton).toHaveTextContent('Douala, Limbé')
  // tout désélectionner : état de saisie, le filtre ne change pas encore
  fireEvent.click(screen.getByRole('button', { name: 'Tout désélectionner' }))
  expect(cases().some((c) => c.checked)).toBe(false)
  expect(screen.getByText('Cochez au moins une valeur')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Douala' }))
  expect(screen.getByRole('status')).toHaveTextContent(/^Douala$/)
  // tout recocher revient à « tous » (valeur vide)
  fireEvent.click(screen.getByRole('button', { name: 'Tout sélectionner' }))
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
  expect(bouton).toHaveTextContent('Tous')
})

test('fermer sans aucune case cochée remet le filtre à tous', () => {
  render(<Banc depart="Kribi" />)
  const bouton = screen.getByRole('button', { name: /^Site/ })
  fireEvent.click(bouton)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Kribi' }))
  expect(bouton).toHaveTextContent('Aucun')
  fireEvent.mouseDown(document.body)
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
  expect(bouton).toHaveTextContent('Tous')
})

const VILLES = ['Bafoussam', 'Bertoua', 'Douala', 'Ebolowa', 'Garoua', 'Kribi', 'Limbé', 'Maroua', 'Yaoundé']

test('avec une recherche, les boutons n’agissent que sur les valeurs affichées', () => {
  render(<Banc options={VILLES} />)
  fireEvent.click(screen.getByRole('button', { name: /^Site/ }))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'b' } }) // Bafoussam, Bertoua, Ebolowa, Kribi, Limbé
  fireEvent.click(screen.getByRole('button', { name: 'Tout désélectionner' }))
  expect(screen.getByRole('status')).toHaveTextContent(/^Douala\|Garoua\|Maroua\|Yaoundé$/)
})

test('Échap et clic à l’extérieur ferment le panneau ; recherche sans accents au-delà de 8 valeurs', () => {
  render(<Banc options={VILLES} />)
  const bouton = screen.getByRole('button', { name: /^Site/ })
  fireEvent.click(bouton)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'limbe' } })
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(bouton).toHaveFocus()
  fireEvent.click(bouton)
  fireEvent.mouseDown(document.body)
  expect(screen.queryByRole('checkbox')).toBeNull()
})
