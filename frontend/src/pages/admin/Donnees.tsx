import { useSearchParams } from 'react-router-dom'
import { useTableau, type FiltresTableau, type LigneTableau } from '../../api/donnees'
import ChoixSalarie from '../../components/ChoixSalarie'
import Etat, { etatErreur } from '../../components/Etat'
import { largeurEntete, MOIS, valeurBrute } from '../../lib/format'

// Lignes 1 et 2 de la feuille DONNEES (REPORTING_RH_V5.xlsx), reprises à l'identique.
const TITRE = 'FEUILLE DE DONNÉES CENTRALE — une ligne par employé et par mois'
const CONSIGNE =
  'Saisir ANNÉE (ex. 2025), MOIS (nom dans la liste) et MATRICULE (clé unique, ex. EMP001). Ajouter les nouveaux mois à la suite. Le TOTAL se calcule seul.'
// Les quatre premières colonnes (ANNÉE à Noms) restent figées au défilement horizontal.
const FIGEES = ['ANNÉE', 'MOIS', 'MATRICULE', 'Noms']
const FIXES = [...FIGEES, 'Poste', 'Type Contrat', 'Activité', 'Site', 'Service']
const EXCLUSIONS = 'Total exclusions (technique)'
const TOTAL = 'TOTAL CHARGES (FCFA)'
const CLES = ['annee', 'mois', 'service', 'site', 'matricule'] as const

const texte = (l: LigneTableau) => [
  l.annee, MOIS[l.mois - 1], l.matricule, l.nom, l.poste ?? '', l.type_contrat, l.activite, l.site, l.service,
]
const classeFixe = (i: number) => (i < FIGEES.length ? `fige fige-${i + 1}` : undefined)

export default function Donnees() {
  const [params, setParams] = useSearchParams()
  const filtres: FiltresTableau = Object.fromEntries(CLES.map((k) => [k, params.get(k) ?? undefined]))
  const q = useTableau(filtres)
  const d = q.data

  const changer = (patch: FiltresTableau) =>
    setParams((p) => {
      for (const [k, v] of Object.entries(patch)) (v ? p.set(k, v) : p.delete(k))
      return p
    }, { replace: true })

  // Rubriques comptées d'abord, puis celles exclues du total, regroupées juste avant le TOTAL.
  const exclues = new Set(d?.exclues)
  const comptees = d?.colonnes.filter((c) => !exclues.has(c)) ?? []
  const horsTotal = d?.colonnes.filter((c) => exclues.has(c)) ?? []

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
        {/* Employé et Réinitialiser forment un bloc insécable : le bouton reste sur la ligne du filtre. */}
        <div className="filtres-fin">
          {/* Pas de <label> englobant : un clic sur une option rouvrirait la liste. */}
          <div className="filtre">
            <span aria-hidden="true">Employé</span>
            <ChoixSalarie
              salaries={d?.filtres.salaries ?? []}
              valeur={filtres.matricule ?? ''}
              onChange={(m) => changer({ matricule: m })}
            />
          </div>
          <button
            type="button"
            className="bouton bouton-lien"
            onClick={() => setParams({}, { replace: true })}
            disabled={!CLES.some((k) => params.has(k))}
          >
            Réinitialiser
          </button>
        </div>
      </div>
      {q.isLoading && <Etat type="chargement" />}
      {q.isError && <Etat type={etatErreur(q.error)} />}
      {d && (
        <>
          <p className="bandeau" role="status">
            {d.lignes.length} ligne{d.lignes.length > 1 ? 's' : ''}
            {horsTotal.length > 0 && <span className="legende-exclu">Colonnes hachurées : exclues du TOTAL</span>}
          </p>
          {d.lignes.length === 0 ? (
            <Etat type="vide" />
          ) : (
            <div className="panneau">
              <div className="panneau-corps" tabIndex={0} role="region" aria-label="Lignes de la feuille DONNEES">
                <table className="dense">
                  <thead>
                    <tr>
                      {FIXES.map((c, i) => <th key={c} scope="col" className={classeFixe(i)} style={i < FIGEES.length ? undefined : { minWidth: largeurEntete(c) }}>{c}</th>)}
                      {comptees.map((c) => <th key={c} scope="col" className="num" style={{ minWidth: largeurEntete(c) }}>{c}</th>)}
                      {horsTotal.map((c, i) => (
                        <th key={c} scope="col" className={`num exclu${i === 0 ? ' exclu-debut' : ''}`} style={{ minWidth: largeurEntete(c) }}>
                          {c}
                          <span className="exclu-mention"> (exclu)</span>
                        </th>
                      ))}
                      <th scope="col" className={`num exclu${horsTotal.length ? '' : ' exclu-debut'}`} style={{ minWidth: largeurEntete(EXCLUSIONS) }}>{EXCLUSIONS}</th>
                      <th scope="col" className="num total" style={{ minWidth: largeurEntete(TOTAL) }}>{TOTAL}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.lignes.map((l) => (
                      <tr key={`${l.annee}-${l.mois}-${l.matricule}`}>
                        {texte(l).map((v, i) => (
                          <td key={FIXES[i]} className={classeFixe(i)} title={i === 3 ? String(v) : undefined}>{v}</td>
                        ))}
                        {comptees.map((c) => <td key={c} className="num">{valeurBrute(l.montants[c])}</td>)}
                        {horsTotal.map((c, i) => (
                          <td key={c} className={`num exclu${i === 0 ? ' exclu-debut' : ''}`}>{valeurBrute(l.montants[c])}</td>
                        ))}
                        <td className={`num exclu${horsTotal.length ? '' : ' exclu-debut'}`}>{valeurBrute(l.exclusions)}</td>
                        <td className="num total">{valeurBrute(l.total)}</td>
                      </tr>
                    ))}
                    {/* Ligne de remplissage : le tableau occupe toute la hauteur du panneau, même avec peu de lignes. */}
                    <tr className="reste" aria-hidden="true">
                      {Array.from({ length: FIXES.length + comptees.length + horsTotal.length + 2 }, (_, i) => <td key={i} />)}
                    </tr>
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
