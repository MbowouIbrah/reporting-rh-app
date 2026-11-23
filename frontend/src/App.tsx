import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth'
import Layout from './components/Layout'
import LimiteErreur from './components/LimiteErreur'
import VersCharges from './components/VersCharges'
import ChangerMotDePasse from './pages/ChangerMotDePasse'
import Charges from './pages/Charges'
import Individuel from './pages/Individuel'
import Login from './pages/Login'
import Reinitialiser from './pages/Reinitialiser'
import ConnexionRapide from './pages/ConnexionRapide'
import Desabonnement from './pages/Desabonnement'
import Correspondance from './pages/admin/Correspondance'
import Donnees from './pages/admin/Donnees'
import Employes from './pages/admin/Employes'
import Referentiels from './pages/admin/Referentiels'
import Saisie from './pages/admin/Saisie'
import Utilisateurs from './pages/admin/Utilisateurs'
import Resume from './pages/Resume'
import { chargerGraphes, chargerRapport } from './lib/pagesDifferees'

const Graphes = lazy(chargerGraphes)
const Rapport = lazy(chargerRapport)

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reinitialiser" element={<Reinitialiser />} />
      <Route path="/connexion-rapide" element={<ConnexionRapide />} />
      <Route path="/desabonnement" element={<Desabonnement />} />
      <Route path="/changer-mot-de-passe" element={<ChangerMotDePasse />} />
      <Route
        path="/rapport"
        element={
          <RequireAuth>
            <LimiteErreur page>
              <Suspense fallback={null}>
                <Rapport />
              </Suspense>
            </LimiteErreur>
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
        <Route path="/budget-realise" element={<Resume />} />
        <Route path="/charges" element={<Charges />} />
        <Route path="/mensuel" element={<VersCharges />} />
        <Route path="/annuel" element={<VersCharges />} />
        <Route
          path="/graphes"
          element={
            // Le temps du chargement du code, un écran vide de même taille (la page ne rétrécit pas) : la page dessine ensuite sa propre structure.
            <LimiteErreur>
              <Suspense fallback={<section className="page-ecran page-etroite" />}>
                <Graphes />
              </Suspense>
            </LimiteErreur>
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
          path="/admin/correspondance"
          element={
            <RequireAuth perm="referentiel:write">
              <Correspondance />
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
