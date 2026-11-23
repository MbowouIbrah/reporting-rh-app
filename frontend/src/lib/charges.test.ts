import { expect, test } from 'vitest'
import type { ChargesPersonne } from '../api/types'
import { csvPersonnes } from './charges'

const personne = (nom: string): ChargesPersonne => ({
  matricule: 'E1', nom, service: 'Atelier', site: 'Douala', activite: 'VN', contrat: 'CDI', poste: 'Conseiller',
  m1: '10', m: '12', var: '2', var_pct: '0.2', entree: false, sortie: false, part: '0.5',
})

test('export CSV : une apostrophe neutralise les textes qui commencent par = + - @', () => {
  const csv = csvPersonnes(['=SOMME(A1)', '+33 1', '-x', '@cmd', 'Ann'].map(personne))
  const lignes = csv.split('\r\n')
  expect(lignes[1]).toContain(";'=SOMME(A1);")
  expect(lignes[2]).toContain(";'+33 1;")
  expect(lignes[3]).toContain(";'-x;")
  expect(lignes[4]).toContain(";'@cmd;")
  expect(lignes[5]).toContain(';Ann;')
})
