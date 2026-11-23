import { expect, test } from 'vitest'
import { idsSections, sectionsPermises } from './sectionsRapport'

test('anciennes parties annuel et mensuel : reprises vers la répartition des charges', () => {
  const ids = idsSections('resume,annuel,mensuel')
  expect(ids).toEqual(['resume', 'charges', 'charges'])
  const parties = sectionsPermises(() => true).filter((s) => ids.includes(s.id))
  expect(parties.map((s) => s.id)).toEqual(['resume', 'charges'])
})

test('anciens liens seuls : au moins une partie, jamais un rapport vide', () => {
  const ids = idsSections('annuel,mensuel')
  expect(sectionsPermises(() => true).filter((s) => ids.includes(s.id)).map((s) => s.id)).toEqual(['charges'])
  expect(idsSections(null)).toEqual([''])
})
