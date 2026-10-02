import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth'
import Etat from './components/Etat'
import Layout from './components/Layout'
import Annuel from './pages/Annuel'
import Individuel from './pages/Individuel'
import Login from './pages/Login'
import Periodes from './pages/admin/Periodes'
import Mensuel from './pages/Mensuel'
import Resume from './pages/Resume'

const Graphes = lazy(() => import('./pages/Graphes'))

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/resume" element={<Resume />} />
        <Route path="/mensuel" element={<Mensuel />} />
        <Route path="/annuel" element={<Annuel />} />
        <Route
          path="/graphes"
          element={
            <Suspense fallback={<Etat type="chargement" />}>
              <Graphes />
            </Suspense>
          }
        />
        <Route
          path="/individuel"
          element={
            <RequireAuth perm="nominatif:read">
              <Individuel />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/periodes"
          element={
            <RequireAuth perm="saisie:write">
              <Periodes />
            </RequireAuth>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/resume" replace />} />
    </Routes>
  )
}
