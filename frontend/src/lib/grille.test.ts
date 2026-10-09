import { coller, estMontant, lireTSV, nettoyer, type Ligne } from './grille'

test('montants acceptés comme côté serveur, en texte', () => {
  for (const ok of ['', '1000', '1 000', '1 000,5', '1 234 567.25', '-12', '0,125']) expect(estMontant(ok)).toBe(true)
  for (const ko of ['abc', '1,000.5', '12 FCFA', '1e3', '1  000', '=A1']) expect(estMontant(ko)).toBe(false)
  expect(nettoyer(' 1 000 ')).toBe('1 000')
})

test('TSV Excel : tabulations, \\r\\n, ligne vide finale, cellules entre guillemets', () => {
  expect(lireTSV('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']])
  expect(lireTSV('1 000')).toEqual([['1 000']])
  expect(lireTSV('"x\ny"\t2\n\t3')).toEqual([['x\ny', '2'], ['', '3']])
  expect(lireTSV('"a""b"\tc')).toEqual([['a"b', 'c']])
})

test('collage : saute la lecture seule, crée les lignes manquantes, coupe à la dernière colonne', () => {
  const cols = ['matricule', 'nom', 'r:A', 'r:B']
  const lignes: Ligne[] = [{ matricule: 'E1', nom: 'Ann', 'r:A': '', 'r:B': '', connu: '1' }]
  const modifiable = (l: Ligne, c: string) => !(l.connu && (c === 'matricule' || c === 'nom'))
  const nouvelle = () => ({ matricule: '', nom: '', 'r:A': '', 'r:B': '' })
  const out = coller(lignes, 0, 0, [['X', 'Y', '1 000', '2', 'trop'], ['E9', 'Neo', '3', '4']], cols, modifiable, nouvelle)
  expect(out[0]).toMatchObject({ matricule: 'E1', nom: 'Ann', 'r:A': '1 000', 'r:B': '2' })
  expect(out[1]).toEqual({ matricule: 'E9', nom: 'Neo', 'r:A': '3', 'r:B': '4' })
  expect(lignes[0]['r:A']).toBe('') // pas de mutation
})
