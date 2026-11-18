import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { indice, mois, plage, type Sel, versTexte } from '../lib/periode'
import ChoixPeriode from './ChoixPeriode'

const MIN = indice(2025, 1)
const MAX = indice(2026, 10)

function Banc({ depart, longueur, modele, moisSeul }: { depart: Sel; longueur?: number; modele?: Sel; moisSeul?: boolean }) {
  const [v, setV] = useState(depart)
  return (
    <>
      <ChoixPeriode titre="Période" valeur={v} onChange={setV} min={MIN} max={MAX} longueur={longueur} modele={modele} moisSeul={moisSeul} />
      <output>{versTexte(v)}</output>
    </>
  )
}

const ouvrir = () => fireEvent.click(screen.getByRole('button', { name: /Période/ }))
const mois2026 = (nom: string) => screen.getByRole('button', { name: `${nom} 2026` })

test('le bouton dit la période en toutes lettres ; rien ne s\'applique avant OK', () => {
  render(<Banc depart={mois(indice(2026, 10))} />)
  expect(screen.getByRole('button', { name: 'Période Octobre 2026' })).toHaveAttribute('aria-expanded', 'false')
  ouvrir()
  expect(screen.getByRole('dialog', { name: 'Période' })).toBeInTheDocument()
  expect(mois2026('octobre')).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(mois2026('mars'))
  expect(screen.getByRole('status')).toHaveTextContent('2026-10')
  fireEvent.click(screen.getByRole('button', { name: 'OK' }))
  expect(screen.getByRole('status')).toHaveTextContent('2026-03')
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('deux mois forment une plage ; un mois hors des données est grisé', () => {
  render(<Banc depart={mois(indice(2026, 10))} />)
  ouvrir()
  expect(mois2026('novembre')).toBeDisabled()
  fireEvent.click(mois2026('octobre'))
  fireEvent.click(mois2026('février'))
  fireEvent.click(mois2026('mai'))
  fireEvent.click(screen.getByRole('button', { name: 'OK' }))
  expect(screen.getByRole('status')).toHaveTextContent('2026-02..2026-05')
})

test('clic sur l\'année : janvier au dernier mois disponible', () => {
  render(<Banc depart={mois(indice(2026, 10))} />)
  ouvrir()
  fireEvent.click(screen.getByRole('button', { name: '2026' }))
  fireEvent.click(screen.getByRole('button', { name: 'OK' }))
  expect(screen.getByRole('status')).toHaveTextContent('2026-01..2026-10')
})

test('Échap ou un clic à côté annule', () => {
  render(<Banc depart={mois(indice(2026, 10))} />)
  ouvrir()
  fireEvent.click(mois2026('mars'))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('2026-10')
  ouvrir()
  fireEvent.mouseDown(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('comparaison : OK grisé tant que la longueur diffère de celle de la période', () => {
  const periode = plage(indice(2026, 1), indice(2026, 3))
  render(<Banc depart={plage(indice(2025, 1), indice(2025, 3))} longueur={3} modele={periode} />)
  ouvrir()
  const m = (nom: string) => screen.getByRole('button', { name: `${nom} 2025` })
  fireEvent.click(m('janvier'))
  fireEvent.click(m('mai'))
  expect(screen.getByRole('button', { name: 'OK' })).toBeEnabled()
  fireEvent.click(m('août'))
  expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
  expect(screen.getByText('Il faut 3 mois, comme la période')).toBeInTheDocument()
})

test('page mensuelle : un seul mois, pas de clic sur l\'année', () => {
  render(<Banc depart={mois(indice(2026, 10))} moisSeul />)
  ouvrir()
  expect(screen.queryByRole('button', { name: '2026' })).toBeNull()
  fireEvent.click(mois2026('mars'))
  fireEvent.click(mois2026('juin'))
  fireEvent.click(screen.getByRole('button', { name: 'OK' }))
  expect(screen.getByRole('status')).toHaveTextContent('2026-06')
})
