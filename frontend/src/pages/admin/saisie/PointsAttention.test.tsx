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

const LOT = { id: 7, statut: 'pret' } as saisie.Lot
const decisions = (d: Partial<saisie.Decisions>): saisie.Decisions => ({ lignes: {}, ajouts: [], retirees: [], ignores: [], ...d })

/** Rien n'est enregistré avant « Enregistrer » ; la vérification renvoie les points restants. */
function serveur(restants: AnomalieLot[] = []) {
  return {
    simuler: vi.spyOn(saisie, 'simulerDecisions').mockResolvedValue({ anomalies: restants }),
    appliquer: vi.spyOn(saisie, 'appliquerDecisions').mockResolvedValue(LOT),
  }
}

test('cellule de la ligne corrigée sur place, liste proposée sans obligation, lot renvoyé', async () => {
  vi.spyOn(saisie, 'lireLigne').mockResolvedValue({
    ligne: 4, annee: 2026, mois: 8, matricule: 'EMP004', nom: 'John Doe', poste: 'Vendeur', type_contrat: 'CDI',
    activite: 'VN', site: null, service: 'SAV PL', montants: { Bonus: '1000' },
    brut: { 'ANNÉE': '2026', MOIS: 'Août', MATRICULE: 'EMP004', Noms: 'John Doe', Site: 'Kribi', Bonus: '1000' },
    choix: { Site: ['Bertoua', 'Douala'] },
  })
  const { appliquer } = serveur()
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
  expect(screen.queryByText(/Cliquez sur une cellule/)).toBeNull()
  // Autre colonne que celle du point : modifiable aussi.
  fireEvent.click([...ligne.querySelectorAll('td')].find((td) => /^1\D?000/.test(td.textContent ?? ''))!)
  const bonus = screen.getByRole('textbox', { name: 'Bonus, ligne 4' })
  fireEvent.change(bonus, { target: { value: '1200' } })
  fireEvent.keyDown(bonus, { key: 'Escape' })
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
  fireEvent.click([...ligne.querySelectorAll('td')].find((td) => td.textContent === 'Kribi')!)
  const site = screen.getByRole('combobox', { name: 'Site, ligne 4' })
  // Valeur inconnue du fichier : toute la liste est proposée dès l'ouverture.
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Bertoua', 'Douala'])
  // Valeur inconnue tapée : la liste ne garde que les valeurs qui la contiennent.
  fireEvent.change(site, { target: { value: 'dou' } })
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Douala'])
  fireEvent.change(site, { target: { value: '' } })
  expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Bertoua', 'Douala'])
  fireEvent.change(site, { target: { value: 'Limbé' } })
  fireEvent.keyDown(site, { key: 'Enter' })
  // Rien ne part avant « Enregistrer ».
  expect(appliquer).not.toHaveBeenCalled()
  expect(within(ligne).getByText('Limbé')).toHaveClass('cellule-modifiee')
  expect(screen.getByText(/1 changement en attente/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
  await vi.waitFor(() => expect(appliquer).toHaveBeenCalledWith(7, decisions({ lignes: { 4: { Site: 'Limbé' } } })))
  expect(appliquer).toHaveBeenCalledTimes(1)
  await vi.waitFor(() => expect(onLot).toHaveBeenCalledWith(LOT))
})

test('saisie en grille : pas de colonne Ligne', () => {
  render(<Volets afficherLigne={false} anomalies={[anomalie('MUTATION')]} />)
  expect(screen.queryByRole('columnheader', { name: 'Ligne' })).toBeNull()
  expect(screen.getByText('Changements d’affectation')).toBeInTheDocument()
})

const LIGNE_BRUTE = {
  ligne: 40, annee: 2026, mois: 8, matricule: 'EMP004', nom: 'John Doe', poste: 'Vendeur', type_contrat: null,
  activite: 'VN', site: 'Kribi', service: 'SAV PL', montants: {},
  brut: { 'ANNÉE': '2026', MOIS: 'Août', MATRICULE: 'EMP004', Noms: 'John Doe', 'Type Contrat': '', Site: 'Kribi', Bonus: '#N/A' },
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

test('doublon : un seul tableau pour les deux lignes ; « Garder la ligne 41 » enregistré retire la ligne 40', async () => {
  vi.spyOn(saisie, 'lireLigne').mockResolvedValue(LIGNE_BRUTE)
  const { appliquer } = serveur()
  const onLot = vi.fn()
  pointsOuverts({ ...anomalie('DOUBLON', 'bloquant', 'Même employé deux fois.', 'MATRICULE'), ligne: 40, proposition: { lignes: [40, 41] } }, onLot)
  const liste = await screen.findByRole('combobox', { name: 'Employé sur plusieurs lignes du même mois : quelle ligne garder ?' })
  expect(within(liste).getAllByRole('option').map((o) => o.textContent)).toEqual([
    'Choisir une solution…', 'Garder la ligne 40, supprimer la ligne 41', 'Garder la ligne 41, supprimer la ligne 40'])
  // Les deux lignes, dans l'ordre du fichier, sous un seul en-tête.
  const tableau = await screen.findByRole('table', { name: 'Lignes 40 et 41 du fichier' })
  expect(within(tableau).getAllByRole('columnheader', { name: 'MATRICULE' })).toHaveLength(1)
  expect(within(tableau).getAllByRole('rowheader').map((c) => c.textContent)).toEqual(['40', '41'])
  expect(liste).toHaveValue('')
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
  fireEvent.change(liste, { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
  await vi.waitFor(() => expect(appliquer).toHaveBeenCalledWith(7, decisions({ retirees: [40] })))
  await vi.waitFor(() => expect(onLot).toHaveBeenCalledWith(LOT))
})

test('valeur manquante : « Remplacer » envoie la valeur du mois précédent', async () => {
  vi.spyOn(saisie, 'lireLigne').mockResolvedValue(LIGNE_BRUTE)
  const { appliquer } = serveur()
  pointsOuverts({ ...anomalie('VALEUR_MANQUANTE', 'bloquant', 'Obligatoire.', 'Type Contrat'), ligne: 40, valeur: null,
    proposition: { valeur: 'CDD', periode: 'juillet 2026' } })
  const liste = await screen.findByRole('combobox', { name: 'Type Contrat vide : que faire ?' })
  fireEvent.change(liste, { target: { value: '0' } })
  // La valeur reprise s'affiche dans la cellule avant l'enregistrement.
  expect(within(screen.getByRole('table', { name: 'Ligne 40 du fichier' })).getByText('CDD')).toHaveClass('cellule-modifiee')
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
  await vi.waitFor(() => expect(appliquer).toHaveBeenCalledWith(7, decisions({ lignes: { 40: { 'Type Contrat': 'CDD' } } })))
})

test('site inconnu : ajout bloqué tant qu’aucun type n’est choisi, puis envoyé avec le type', async () => {
  vi.spyOn(saisie, 'lireLigne').mockResolvedValue(LIGNE_BRUTE)
  const { appliquer } = serveur()
  pointsOuverts({ ...anomalie('REFERENTIEL_INCONNU', 'bloquant', 'Valeur inconnue.', 'Site'), ligne: 40, valeur: 'Kribi',
    proposition: { dimension: 'site' } })
  fireEvent.change(await screen.findByRole('combobox', { name: 'Site « Kribi » absent de la liste des sites : que faire ?' }),
    { target: { value: '0' } })
  const bouton = screen.getByRole('button', { name: 'Enregistrer' })
  expect(bouton).toBeDisabled()  // type du nouveau site attendu
  fireEvent.change(screen.getByRole('combobox', { name: 'Type du nouveau site' }), { target: { value: 'agence' } })
  expect(bouton).toBeEnabled()
  fireEvent.click(bouton)
  await vi.waitFor(() => expect(appliquer).toHaveBeenCalledWith(7,
    decisions({ ajouts: [{ dimension: 'site', valeur: 'Kribi', type_site: 'agence' }] })))
})

test('montant illisible : « Ignorer la valeur » laisse la cellule vide ; le point passe au vert sans quitter la liste', async () => {
  vi.spyOn(saisie, 'lireLigne').mockResolvedValue(LIGNE_BRUTE)
  const { simuler, appliquer } = serveur()
  pointsOuverts({ ...anomalie('ERREUR_EXCEL', 'bloquant', 'Erreur Excel.', 'Bonus'), ligne: 40, valeur: '#N/A' })
  const point = screen.getByText('Erreur Excel.').closest('tr')!
  expect(point).not.toHaveClass('point-regle')
  const liste = await screen.findByRole('combobox', { name: 'Bonus « #N/A » : que faire ?' })
  expect(within(liste).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choisir une solution…', 'Ignorer la valeur (laisser vide)'])
  fireEvent.change(liste, { target: { value: 'ignorer' } })
  const attendu = decisions({ lignes: { 40: { Bonus: null } }, ignores: ['40|Bonus'] })
  // Vérification sans enregistrer : le point n'est plus renvoyé, il passe au vert.
  await vi.waitFor(() => expect(simuler).toHaveBeenCalledWith(7, attendu))
  await vi.waitFor(() => expect(screen.getByText('Erreur Excel.').closest('tr')).toHaveClass('point-regle'))
  expect(appliquer).not.toHaveBeenCalled()
  expect(liste).toHaveValue('ignorer')
  // La colonne reste affichée, sa cellule passe au vert, comme le liseré de la ligne.
  const ligne = screen.getByRole('table', { name: 'Ligne 40 du fichier' })
  const bonus = [...ligne.querySelectorAll('th')].findIndex((th) => th.textContent === 'Bonus')
  expect(bonus).toBeGreaterThan(0)
  expect(ligne.querySelectorAll('tbody td')[bonus]).toHaveClass('cellule-ok')
  expect(ligne.closest('tr.detail-contrat')).toHaveClass('detail-regle')
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
  await vi.waitFor(() => expect(appliquer).toHaveBeenCalledWith(7, attendu))
})

test('un choix s’annule seul : « Annuler ce choix » rend la liste à « Choisir une solution… »', async () => {
  vi.spyOn(saisie, 'lireLigne').mockResolvedValue(LIGNE_BRUTE)
  serveur()
  pointsOuverts({ ...anomalie('ERREUR_EXCEL', 'bloquant', 'Erreur Excel.', 'Bonus'), ligne: 40, valeur: '#N/A' })
  const liste = await screen.findByRole('combobox', { name: 'Bonus « #N/A » : que faire ?' })
  fireEvent.change(liste, { target: { value: 'ignorer' } })
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled()
  fireEvent.change(liste, { target: { value: '' } })
  expect(liste).toHaveValue('')
  expect(within(liste).getAllByRole('option')[0]).toHaveTextContent('Choisir une solution…')
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
})

test('point sans autre solution que la saisie : texte par défaut', async () => {
  vi.spyOn(saisie, 'lireLigne').mockResolvedValue(LIGNE_BRUTE)
  serveur()
  pointsOuverts({ ...anomalie('ABSENCES_HORS_BORNES', 'bloquant', 'Hors bornes.', 'Absences'), ligne: 40, valeur: '45' })
  expect(await screen.findByText(/^Veuillez saisir une valeur conforme/)).toBeInTheDocument()
  expect(screen.queryByRole('combobox')).toBeNull()
})
