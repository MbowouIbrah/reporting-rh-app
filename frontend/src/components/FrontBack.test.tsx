import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FrontBackLigne } from './BlocsRapport'

describe('FrontBackLigne', () => {
  it('affiche les parts front et back office avec les effectifs', () => {
    render(<FrontBackLigne fb={{ front: 31, back: 19, total: 50, front_pct: '0.62', back_pct: '0.38' }} />)
    const p = screen.getByText(/Front \/ Back office/).closest('p')!
    expect(p.textContent).toMatch(/62\s?%.*\/.*38\s?%/)
    expect(p.textContent).toContain('31 front, 19 back sur 50')
  })
})
