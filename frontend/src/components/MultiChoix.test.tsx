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

test('résumé, cases à cocher et valeur jointe par « | » dans l’ordre des options', () => {
  render(<Banc />)
  const bouton = screen.getByRole('button', { name: 'Site Tous' })
  fireEvent.click(bouton)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Limbé' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Douala' }))
  expect(screen.getByRole('status')).toHaveTextContent(/^Douala\|Limbé$/)
  expect(bouton).toHaveTextContent('Douala, Limbé')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Kribi' }))
  expect(bouton).toHaveTextContent('3 sites')
  fireEvent.click(screen.getByRole('button', { name: 'Tout effacer' }))
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
  expect(bouton).toHaveTextContent('Tous')
})

test('Échap et clic à l’extérieur ferment le panneau ; recherche sans accents au-delà de 8 valeurs', () => {
  const options = ['Bafoussam', 'Bertoua', 'Douala', 'Ebolowa', 'Garoua', 'Kribi', 'Limbé', 'Maroua', 'Yaoundé']
  render(<Banc options={options} />)
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
