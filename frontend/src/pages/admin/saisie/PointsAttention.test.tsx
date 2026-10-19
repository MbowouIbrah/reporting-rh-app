import { fireEvent, render, screen, within } from '@testing-library/react'
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

test('un clic sur la ligne du point déplie la ligne du fichier (en-tête et valeurs)', async () => {
  vi.spyOn(saisie, 'lireLigne').mockResolvedValue({
    ligne: 4, annee: 2026, mois: 8, matricule: 'EMP004', nom: 'John Doe', poste: 'Vendeur', type_contrat: 'CDI',
    activite: 'VN', site: null, service: 'SAV PL', montants: { Bonus: '1000' }, brut: null, choix: null,
  })
  render(<Volets lotId={7} anomalies={[anomalie('REFERENTIEL_INCONNU', 'bloquant', 'Valeur inconnue.', 'Site')]} />)
  const deplier = screen.getByRole('button', { name: 'Détail de la ligne 4' })
  expect(deplier).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(screen.getByText('Valeur inconnue.'))
  expect(deplier).toHaveAttribute('aria-expanded', 'true')
  const ligne = await screen.findByRole('table', { name: 'Ligne 4 du fichier' })
  expect(screen.queryByText(/Détail de la ligne/)).toBeNull()
  expect(saisie.lireLigne).toHaveBeenCalledWith(7, 4)
  const cellule = [...ligne.querySelectorAll('td')].find((td) => td.textContent === 'Jhon')!
  expect(cellule).toHaveClass('cellule-ko', 'cellule-cible')
  expect(ligne).toHaveTextContent('Août')
  fireEvent.click(deplier)
  expect(screen.queryByRole('table', { name: 'Ligne 4 du fichier' })).toBeNull()
})

test('cellule de la ligne corrigée sur place, liste proposée sans obligation, lot renvoyé', async () => {
  vi.spyOn(saisie, 'lireLigne').mockResolvedValue({
    ligne: 4, annee: 2026, mois: 8, matricule: 'EMP004', nom: 'John Doe', poste: 'Vendeur', type_contrat: 'CDI',
    activite: 'VN', site: null, service: 'SAV PL', montants: { Bonus: '1000' },
    brut: { 'ANNÉE': '2026', MOIS: 'Août', MATRICULE: 'EMP004', Noms: 'John Doe', Site: 'Kribi', Bonus: '1000' },
    choix: { Site: ['Bertoua', 'Douala'] },
  })
  const lot = { id: 7, statut: 'pret' } as saisie.Lot
  const corriger = vi.spyOn(saisie, 'corrigerLigne').mockResolvedValue(lot)
  const onLot = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PointsAttention lotId={7} onLot={onLot} afficherLigne ouvert={VOLET_ERREURS} onOuvrir={() => {}}
        anomalies={[{ ...anomalie('REFERENTIEL_INCONNU', 'bloquant', 'Valeur inconnue.', 'Site'), valeur: 'Kribi' },
          anomalie('NOM_PROCHE', 'bloquant', 'Nom proche.', 'Noms')]} />
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getAllByRole('button', { name: 'Détail de la ligne 4' })[0])
  const ligne = await screen.findByRole('table', { name: 'Ligne 4 du fichier' })
  // Autre colonne que celle du point : modifiable aussi.
  fireEvent.click([...ligne.querySelectorAll('td')].find((td) => /^1\D?000/.test(td.textContent ?? ''))!)
  const bonus = screen.getByRole('textbox', { name: 'Bonus, ligne 4' })
  fireEvent.change(bonus, { target: { value: '1200' } })
  fireEvent.keyDown(bonus, { key: 'Escape' })
  expect(corriger).not.toHaveBeenCalled()
  fireEvent.click([...ligne.querySelectorAll('td')].find((td) => td.textContent === 'Kribi')!)
  const site = screen.getByRole('combobox', { name: 'Site, ligne 4' })
  // Valeur inconnue tapée : la liste ne garde que les valeurs qui la contiennent.
  fireEvent.change(site, { target: { value: 'dou' } })
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Douala'])
  fireEvent.change(site, { target: { value: '' } })
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Bertoua', 'Douala'])
  fireEvent.change(site, { target: { value: 'Limbé' } })
  fireEvent.keyDown(site, { key: 'Enter' })
  await vi.waitFor(() => expect(corriger).toHaveBeenCalledWith(7, 4, { Site: 'Limbé' }))
  expect(corriger).toHaveBeenCalledTimes(1)
  await vi.waitFor(() => expect(onLot).toHaveBeenCalledWith(lot))
})

test('saisie en grille : pas de colonne Ligne', () => {
  render(<Volets afficherLigne={false} anomalies={[anomalie('MUTATION')]} />)
  expect(screen.queryByRole('columnheader', { name: 'Ligne' })).toBeNull()
  expect(screen.getByText('Changements d’affectation')).toBeInTheDocument()
})

const LIGNE_BRUTE = {
  ligne: 40, annee: 2026, mois: 8, matricule: 'EMP004', nom: 'John Doe', poste: 'Vendeur', type_contrat: null,
  activite: 'VN', site: 'Kribi', service: 'SAV PL', montants: {},
  brut: { 'ANNÉE': '2026', MOIS: 'Août', MATRICULE: 'EMP004', Noms: 'John Doe', 'Type Contrat': '', Site: 'Kribi' },
  choix: { Site: ['Douala'], 'Type Contrat': ['CDD', 'CDI'] },
}

function pointsOuverts(a: AnomalieLot, onLot = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PointsAttention lotId={7} onLot={onLot} afficherLigne ouvert={VOLET_ERREURS} onOuvrir={() => {}} anomalies={[a]} />
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: `Détail de la ligne ${a.ligne}` }))
}

test('doublon : « Garder la ligne 41 » retire la ligne 40', async () => {
  vi.spyOn(saisie, 'lireLigne').mockResolvedValue(LIGNE_BRUTE)
  const lot = { id: 7, statut: 'pret' } as saisie.Lot
  const retirer = vi.spyOn(saisie, 'retirerLigne').mockResolvedValue(lot)
  const onLot = vi.fn()
  pointsOuverts({ ...anomalie('DOUBLON', 'bloquant', 'Même employé deux fois.', 'MATRICULE'), ligne: 40, proposition: { lignes: [40, 41] } }, onLot)
  expect(await screen.findByRole('button', { name: 'Garder la ligne 40' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Garder la ligne 41' }))
  await vi.waitFor(() => expect(retirer).toHaveBeenCalledWith(7, 40))
  expect(retirer).toHaveBeenCalledTimes(1)
  await vi.waitFor(() => expect(onLot).toHaveBeenCalledWith(lot))
})

test('valeur manquante : « Reprendre » envoie la valeur du mois précédent', async () => {
  vi.spyOn(saisie, 'lireLigne').mockResolvedValue(LIGNE_BRUTE)
  const corriger = vi.spyOn(saisie, 'corrigerLigne').mockResolvedValue({ id: 7, statut: 'pret' } as saisie.Lot)
  pointsOuverts({ ...anomalie('VALEUR_MANQUANTE', 'bloquant', 'Obligatoire.', 'Type Contrat'), ligne: 40, valeur: null,
    proposition: { valeur: 'CDD', periode: 'juillet 2026' } })
  fireEvent.click(await screen.findByRole('button', { name: 'Reprendre « CDD » (juillet 2026)' }))
  await vi.waitFor(() => expect(corriger).toHaveBeenCalledWith(7, 40, { 'Type Contrat': 'CDD' }))
  // « Saisir la valeur » ouvre la cellule en édition.
  fireEvent.click(screen.getByRole('button', { name: 'Saisir la valeur' }))
  expect(await screen.findByRole('combobox', { name: 'Type Contrat, ligne 40' })).toBeInTheDocument()
})

test('site inconnu : ajout bloqué tant qu’aucun type n’est choisi, puis envoyé avec le type', async () => {
  vi.spyOn(saisie, 'lireLigne').mockResolvedValue(LIGNE_BRUTE)
  const lot = { id: 7, statut: 'pret' } as saisie.Lot
  const ajouter = vi.spyOn(saisie, 'ajouterReferentiel').mockResolvedValue(lot)
  pointsOuverts({ ...anomalie('REFERENTIEL_INCONNU', 'bloquant', 'Valeur inconnue.', 'Site'), ligne: 40, valeur: 'Kribi',
    proposition: { dimension: 'site' } })
  const bouton = await screen.findByRole('button', { name: 'Ajouter « Kribi » aux sites' })
  expect(bouton).toBeDisabled()
  fireEvent.change(screen.getByRole('combobox', { name: 'Type du site' }), { target: { value: 'agence' } })
  expect(bouton).toBeEnabled()
  fireEvent.click(bouton)
  await vi.waitFor(() => expect(ajouter).toHaveBeenCalledWith(7, 'site', 'Kribi', 'agence'))
})
