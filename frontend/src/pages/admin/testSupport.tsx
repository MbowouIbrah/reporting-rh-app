import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthProvider } from '../../auth/AuthContext'

export interface Appel {
  url: string
  method: string
  body?: Record<string, unknown>
}

export const erreurApi = (status: number, detail: string) => new Response(JSON.stringify({ detail }), { status })

/** Simule l'API : session avec les droits donnés, le reste est servi par `repondre` (JSON, ou une Response). Renvoie les appels reçus. */
export function monter(ui: ReactNode, perms: string[], repondre: (a: Appel) => unknown, chemin = '/admin') {
  const appels: Appel[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
    const appel: Appel = { url: String(u), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined }
    if (appel.url.includes('/auth/me')) {
      return new Response(JSON.stringify({ id: 1, email: 'admin@exemple.invalid', roles: [], permissions: perms }))
    }
    appels.push(appel)
    const r = repondre(appel)
    return r instanceof Response ? r : new Response(JSON.stringify(r ?? {}))
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter initialEntries={[chemin]}>{ui}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return appels
}
