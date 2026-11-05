import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { queryRetry } from './api/client'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { connexionPerdue } from './lib/etatConnexion'
import '@fontsource/dm-sans/latin-300.css'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/dm-sans/latin-700.css'
import '@fontsource/dm-sans/latin-800.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import './styles/base.css'
import './styles/mouvement.css'


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: queryRetry,
      staleTime: 5 * 60 * 1000,
      // Hors ligne, une requête échoue au lieu de rester en pause sans fin (voir docs/etude-reseau.md).
      networkMode: 'always',
      // Pendant une panne, les données déjà affichées restent à l'écran, sans relecture vouée à l'échec.
      refetchOnWindowFocus: () => !connexionPerdue(),
      refetchOnMount: () => !connexionPerdue(),
    },
    mutations: { networkMode: 'always' },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
