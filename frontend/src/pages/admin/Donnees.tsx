import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTableau, type FiltresTableau, type LigneTableau } from '../../api/donnees'
import Etat, { etatErreur } from '../../components/Etat'
import { MOIS, valeurBrute } from '../../lib/format'

// Lignes 1 et 2 de la feuille DONNEES (REPORTING_RH_V5.xlsx), reprises à l'identique.
const TITRE = 'FEUILLE DE DONNÉES CENTRALE — une ligne par employé et par mois'
const CONSIGNE =
  'Saisir ANNÉE (ex. 2025), MOIS (nom dans la liste) et MATRICULE (clé unique, ex. EMP001). Ajouter les nouveaux mois à la suite. Le TOTAL se calcule seul.'
const FIXES = ['ANNÉE', 'MOIS', 'MATRICULE', 'Noms', 'Poste', 'Type Contrat', 'Activité', 'Site', 'Service']
const CALCULEES = ['TOTAL CHARGES (FCFA)', 'Total exclusions (technique)']
const CLES = ['annee', 'mois', 'service', 'site', 'q'] as const

const texte = (l: LigneTableau) => [
  l.annee, MOIS[l.mois - 1], l.matricule, l.nom, l.poste ?? '', l.type_contrat, l.activite, l.site, l.service,
]

export default function Donnees() {
  const [params, setParams] = useSearchParams()
  const filtres: FiltresTableau = Object.fromEntries(CLES.map((k) => [k, params.get(k) ?? undefined]))
  const [recherche, setRecherche] = useState(filtres.q ?? '')
  // Un changement d'URL venu d'ailleurs (onglet, retour arrière) remplace la saisie en cours.
  const [qVu, setQVu] = useState(filtres.q)
  if (qVu !== filtres.q) {
    setQVu(filtres.q)
    setRecherche(filtres.q ?? '')
  }
  const q = useTableau(filtres)
  const d = q.data

  const changer = (patch: FiltresTableau) =>
    setParams((p) => {
      for (const [k, v] of Object.entries(patch)) (v ? p.set(k, v) : p.delete(k))
      return p
    }, { replace: true })

  // La recherche part 300 ms après la dernière frappe.
  useEffect(() => {
    if (recherche.trim() === (filtres.q ?? '')) return
    const t = setTimeout(() => changer({ q: recherche.trim() }), 300)
    return () => clearTimeout(t)
  })

  const actifs = CLES.some((k) => params.has(k))
  const reinitialiser = () => {
    setRecherche('')
    setParams({}, { replace: true })
  }

  return (
    <section className="page-ecran rapport-excel donnees-excel">
      <h2 className="bandeau-titre">{TITRE}</h2>
      <p className="regle">{CONSIGNE}</p>
      <div className="filtres" role="group" aria-label="Filtres">
        <label>
          Année
          <select value={filtres.annee ?? ''} onChange={(e) => changer({ annee: e.target.value })}>
            <option value="">Toutes</option>
            {d?.filtres.annees.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label>
          Mois
          <select value={filtres.mois ?? ''} onChange={(e) => changer({ mois: e.target.value })}>
            <option value="">Tous</option>
            {MOIS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Service
          <select value={filtres.service ?? ''} onChange={(e) => changer({ service: e.target.value })}>
            <option value="">Tous</option>
            {d?.filtres.services.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Site
          <select value={filtres.site ?? ''} onChange={(e) => changer({ site: e.target.value })}>
            <option value="">Tous</option>
            {d?.filtres.sites.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Matricule ou nom
          <input type="search" value={recherche} maxLength={100} onChange={(e) => setRecherche(e.target.value)} />
        </label>
        <button type="button" className="bouton bouton-lien" onClick={reinitialiser} disabled={!actifs && !recherche}>
          Réinitialiser
        </button>
      </div>
      {q.isLoading && <Etat type="chargement" />}
      {q.isError && <Etat type={etatErreur(q.error)} />}
      {d && (
        <>
          <p className="bandeau" role="status">
            {d.lignes.length} ligne{d.lignes.length > 1 ? 's' : ''}
          </p>
          {d.lignes.length === 0 ? (
            <Etat type="vide" />
          ) : (
            <div className="panneau">
              <div className="panneau-corps" tabIndex={0} role="region" aria-label="Lignes de la feuille DONNEES">
                <table className="dense">
                  <thead>
                    <tr>
                      {FIXES.map((c) => <th key={c} scope="col">{c}</th>)}
                      {[...d.colonnes, ...CALCULEES].map((c) => <th key={c} scope="col" className="num">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {d.lignes.map((l) => (
                      <tr key={`${l.annee}-${l.mois}-${l.matricule}`}>
                        {texte(l).map((v, i) => <td key={FIXES[i]}>{v}</td>)}
                        {d.colonnes.map((c) => <td key={c} className="num">{valeurBrute(l.montants[c])}</td>)}
                        <td className="num">{valeurBrute(l.total)}</td>
                        <td className="num">{valeurBrute(l.exclusions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
