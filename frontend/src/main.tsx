import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { queryRetry } from './api/client'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import './styles/base.css'
import './styles/mouvement.css'


const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: queryRetry, staleTime: 5 * 60 * 1000 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter basename="/reporting-rh">
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
