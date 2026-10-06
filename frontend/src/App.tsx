import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth'
import Etat from './components/Etat'
import Layout from './components/Layout'
import Annuel from './pages/Annuel'
import Individuel from './pages/Individuel'
import Login from './pages/Login'
import Acces from './pages/admin/Acces'
import Budgets from './pages/admin/Budgets'
import Cloture from './pages/admin/Cloture'
import Employes from './pages/admin/Employes'
import Journal from './pages/admin/Journal'
import Parametrage from './pages/admin/Parametrage'
import Referentiels from './pages/admin/Referentiels'
import Perimetres from './pages/admin/Perimetres'
import Utilisateurs from './pages/admin/Utilisateurs'
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
          path="/admin/cloture"
          element={
            <RequireAuth perm="saisie:write">
              <Cloture />
            </RequireAuth>
          }
        />
        <Route path="/admin/periodes" element={<Navigate to="/admin/cloture?etape=ca" replace />} />
        <Route path="/admin/donnees" element={<Navigate to="/admin/cloture?etape=donnees" replace />} />
        <Route
          path="/admin/employes"
          element={
            <RequireAuth perm="saisie:write">
              <Employes />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/acces"
          element={
            <RequireAuth perm="users:read">
              <Acces />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/utilisateurs"
          element={
            <RequireAuth perm="users:read">
              <Utilisateurs />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/perimetres"
          element={
            <RequireAuth perm="perimetre:write">
              <Perimetres />
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
          path="/admin/budgets"
          element={
            <RequireAuth perm="saisie:write">
              <Budgets />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/parametrage"
          element={
            <RequireAuth perm="referentiel:write">
              <Parametrage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/journal"
          element={
            <RequireAuth perm="audit:read">
              <Journal />
            </RequireAuth>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/resume" replace />} />
    </Routes>
  )
}
