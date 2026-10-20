import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth'
import Layout from './components/Layout'
import Annuel from './pages/Annuel'
import Individuel from './pages/Individuel'
import Login from './pages/Login'
import Donnees from './pages/admin/Donnees'
import Employes from './pages/admin/Employes'
import Referentiels from './pages/admin/Referentiels'
import Saisie from './pages/admin/Saisie'
import Utilisateurs from './pages/admin/Utilisateurs'
import Mensuel from './pages/Mensuel'
import Resume from './pages/Resume'

const Graphes = lazy(() => import('./pages/Graphes'))
const Rapport = lazy(() => import('./pages/Rapport'))

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/rapport"
        element={
          <RequireAuth>
            <Suspense fallback={null}>
              <Rapport />
            </Suspense>
          </RequireAuth>
        }
      />
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
            // Le temps du chargement du code, rien : la page dessine ensuite sa propre structure.
            <Suspense fallback={null}>
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
          path="/admin"
          element={
            <RequireAuth perm="saisie:write">
              <Donnees />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/saisie"
          element={
            <RequireAuth perm="saisie:write">
              <Saisie />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/employes"
          element={
            <RequireAuth perm="saisie:write">
              <Employes />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/referentiels"
          element={
            <RequireAuth perm="referentiel:write">
              <Referentiels />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/utilisateurs"
          element={
            <RequireAuth perm="users:write">
              <Utilisateurs />
            </RequireAuth>
          }
        />
        <Route path="/admin/*" element={<Navigate to="/admin" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/resume" replace />} />
    </Routes>
  )
}
