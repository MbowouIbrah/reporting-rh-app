import { Link } from 'react-router-dom'
import { useStructure, useTableau, type FiltresTableau, type LigneTableau } from '../../api/donnees'
import BoutonReinitialiser from '../../components/BoutonReinitialiser'
import ChoixSalarie from '../../components/ChoixSalarie'
import Etat, { etatErreur } from '../../components/Etat'
import { usePartage } from '../../hooks/useFiltres'
import { largeurEntete, matriculeAffiche, MOIS, valeurBrute } from '../../lib/format'
import BandeauEnregistre from './saisie/Enregistre'

// Lignes 1 et 2 de la feuille DONNEES (REPORTING_RH_V5.xlsx), reprises à l'identique.
const TITRE = 'ADMINISTRATION DES DONNÉES'
const CONSIGNE =
  'Saisir ANNÉE (ex. 2025), MOIS (nom dans la liste) et MATRICULE (clé unique, ex. EMP001). Ajouter les nouveaux mois à la suite. Le TOTAL se calcule seul.'
// Les quatre premières colonnes (ANNÉE à Noms) restent figées au défilement horizontal.
const FIGEES = ['ANNÉE', 'MOIS', 'MATRICULE', 'Noms']
const FIXES = [...FIGEES, 'Poste', 'Type Contrat', 'Activité', 'Site', 'Service']
const EXCLUSIONS = 'Total exclusions (technique)'
const TOTAL = 'TOTAL CHARGES (FCFA)'
const CLES = ['annee', 'mois', 'service', 'site', 'matricule'] as const

const texte = (l: LigneTableau) => [
  l.annee, MOIS[l.mois - 1], matriculeAffiche(l.matricule), l.nom, l.poste ?? '', l.type_contrat, l.activite, l.site, l.service,
]
const classeFixe = (i: number) => (i < FIGEES.length ? `fige fige-${i + 1}` : undefined)

/** Premier chargement : lignes vides sous l'en-tête complet ; le squelette commun (aria-busy) les habille. */
function LignesSquelette({ lignes, classes }: { lignes: number; classes: (string | undefined)[] }) {
  return Array.from({ length: lignes }, (_, l) => (
    <tr key={l} aria-hidden="true">
      {classes.map((c, i) => <td key={i} className={c} />)}
    </tr>
  ))
}

export default function Donnees() {
  // Filtres partagés avec les pages de reporting : « Toutes » / « Tous » retire la valeur partagée.
  const { partage, set: changer } = usePartage()
  const filtres: FiltresTableau = Object.fromEntries(CLES.map((k) => [k, partage[k]]))
  const q = useTableau(filtres)
  const s = useStructure()
  const d = q.data
  // En-tête et filtres : ceux des lignes affichées, sinon la structure seule (premier chargement).
  const st = d ?? s.data
  const charge = q.isLoading || q.isPlaceholderData
  // Aucune ligne à habiller (premier chargement, ou tableau précédent vide) : lignes vides en squelette.
  const squelette = q.isLoading || (q.isPlaceholderData && !d?.lignes.length)

  // Rubriques comptées d'abord, puis celles exclues du total, regroupées juste avant le TOTAL.
  const exclues = new Set(st?.exclues)
  const comptees = st?.colonnes.filter((c) => !exclues.has(c)) ?? []
  const horsTotal = st?.colonnes.filter((c) => exclues.has(c)) ?? []
  const classes = [
    // Colonnes fixes : texte issu des données (squelette « var ») ; les quatre premières restent figées.
    ...FIXES.map((_, i) => (i < FIGEES.length ? `${classeFixe(i)} var` : 'var')),
    ...comptees.map(() => 'num'),
    ...horsTotal.map((_, i) => `num exclu${i === 0 ? ' exclu-debut' : ''}`),
    ...(st ? [`num exclu${horsTotal.length ? '' : ' exclu-debut'}`, 'num total'] : []),
  ]

  return (
    <section className="page-ecran rapport-excel donnees-excel" aria-busy={charge || undefined}>
      <h2 className="bandeau-titre">{TITRE}</h2>
      <p className="regle">{CONSIGNE}</p>
      <div className="filtres" role="group" aria-label="Filtres">
        <label>
          Année
          <select value={filtres.annee ?? ''} onChange={(e) => changer({ annee: e.target.value })}>
            <option value="">Toutes</option>
            {st?.filtres.annees.map((a) => <option key={a}>{a}</option>)}
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
            {st?.filtres.services.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Site
          <select value={filtres.site ?? ''} onChange={(e) => changer({ site: e.target.value })}>
            <option value="">Tous</option>
            {st?.filtres.sites.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        {/* Employé et Réinitialiser forment un bloc insécable : le bouton reste sur la ligne du filtre. */}
        <div className="filtres-fin">
          {/* Pas de <label> englobant : un clic sur une option rouvrirait la liste. */}
          <div className="filtre">
            <span aria-hidden="true">Employé</span>
            <ChoixSalarie
              salaries={st?.filtres.salaries ?? []}
              valeur={filtres.matricule ?? ''}
              onChange={(m) => changer({ matricule: m })}
            />
          </div>
          <BoutonReinitialiser
            actif={CLES.some((k) => partage[k])}
            onClick={() => changer(Object.fromEntries(CLES.map((k) => [k, undefined])))}
          />
        </div>
      </div>
      <BandeauEnregistre />
      {q.isError && <Etat type={etatErreur(q.error)} />}
      {(d || q.isLoading) && (
        <>
          <p className="bandeau">
            <span className="val">{d ? `${d.lignes.length} ligne${d.lignes.length > 1 ? 's' : ''}` : '—'}</span>
            {horsTotal.length > 0 && <span className="legende-exclu">Colonnes hachurées : exclues du TOTAL</span>}
            <Link className="bouton bouton-primaire bandeau-action" to="/admin/saisie">Renseigner des données</Link>
          </p>
          {d && d.lignes.length === 0 && !charge ? (
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
                      {st && (
                        <>
                          <th scope="col" className={`num exclu${horsTotal.length ? '' : ' exclu-debut'}`} style={{ minWidth: largeurEntete(EXCLUSIONS) }}>{EXCLUSIONS}</th>
                          <th scope="col" className="num total" style={{ minWidth: largeurEntete(TOTAL) }}>{TOTAL}</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {squelette && <LignesSquelette lignes={10} classes={classes} />}
                    {!squelette && d?.lignes.map((l) => (
                      <tr key={`${l.annee}-${l.mois}-${l.matricule}`}>
                        {texte(l).map((v, i) => (
                          <td key={FIXES[i]} className={classes[i]} title={i === 3 ? String(v) : undefined}>{v}</td>
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
                      {classes.map((_, i) => <td key={i} />)}
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
