import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { viderPartage } from './lib/filtresPartages'

configure({ asyncUtilTimeout: 4000 })

// Les filtres partagés vivent au niveau du module, le profil de session dans sessionStorage :
// chaque test repart à vide.
beforeEach(() => {
  viderPartage()
  sessionStorage.clear()
})
