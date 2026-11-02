import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getMensuel } from '../api/rapports'
import type { Mensuel as MensuelData } from '../api/types'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode, { libelleComparaison, libellePeriode } from '../components/FiltresPeriode'
import { Activite, AnalyseEffectifs, Contrats, RapportSquelette, ServicesActivites, Sites, TypesCharge } from '../components/BlocsRapport'
import SnapSections from '../components/SnapSections'
import { useAttente } from '../hooks/useAttente'
import { useGabarit } from '../lib/gabarit'
import { useFiltres } from '../hooks/useFiltres'
import { useSalaries } from '../hooks/useSalaries'
import { entier, pct } from '../lib/format'
import { TitreRapport } from '../components/ExportPdf'

export default function Mensuel() {
  const f = useFiltres({ comparaison: 'periode' })
  const salaries = useSalaries(f.filtres?.annee)
  const q = useQuery({
    queryKey: ['mensuel', f.filtres],
    queryFn: () => getMensuel(f.filtres!),
    enabled: !!f.filtres,
    placeholderData: keepPreviousData,
  })
  const [premier, relais] = useAttente(q.isLoading)
  const [maj, relaisMaj] = useAttente(q.isPlaceholderData)
  const gab = useGabarit('mensuel', q.data, !q.isPlaceholderData)
  // Premier chargement : la page à la forme de la dernière réponse, valeurs en squelette.
  const d = premier ? gab : q.data

  return (
    <section className={`page-ecran rapport-excel${maj ? ' maj' : ''}${relais || relaisMaj ? ' relais' : ''}${premier && gab ? ' chargement' : ''}`} aria-busy={maj || premier || undefined}>
      <TitreRapport titre="REPORTING MENSUEL" />
      {f.filtres && (
        <FiltresPeriode comparaison="periode" periodes={f.periodes} filtres={f.filtres} annees={f.annees} services={f.services} sites={f.sites} typesSite={f.typesSite} postes={f.postes} activites={f.activites} typesContrat={f.typesContrat} salaries={salaries} partage={f.partage} onChange={f.set} />
      )}
      {f.vide && <Etat type="vide" />}
      {premier && !gab && f.filtres && (
        <RapportSquelette
          lib={{ prec: libelleComparaison(f.filtres, 'periode'), cour: libellePeriode(f.filtres) }}
          bandeau={
            <>
              <span>Contrôles de cohérence : <strong className="val">—</strong></span>
              <span>Effectif fin de mois : <strong className="val">—</strong></span>
              <span>Taux de rotation : <strong className="val">—</strong></span>
              <span>Taux d’absentéisme : <strong className="val">—</strong></span>
            </>
          }
        />
      )}
      {q.error && !premier && <Etat type={etatErreur(q.error)} />}
      {d && f.filtres && <Contenu d={d} lib={{ prec: libelleComparaison(f.filtres, 'periode'), cour: libellePeriode(f.filtres) }} />}
    </section>
  )
}

function Contenu({ d, lib }: { d: MensuelData; lib: { prec: string; cour: string } }) {
  const s = d.synthese
  const bloquants = d.controles.filter((c) => c.bloquant)
  return (
    <>
      <p className={bloquants.length ? 'bandeau ko' : 'bandeau ok'} role="status">
        <span className="sk-texte">
          {bloquants.length
            ? `Contrôles de cohérence en écart : ${bloquants.map((c) => c.controle).join(' ; ')}`
            : 'Contrôles de cohérence : OK'}
        </span>
        <span>Effectif fin de mois : <strong className="val">{entier(s.effectif.fin)}</strong></span>
        <span>Taux de rotation : <strong className="val">{pct(s.taux_rotation)}</strong></span>
        <span>Taux d’absentéisme : <strong className="val">{pct(s.taux_absenteisme)}</strong></span>
      </p>
      <SnapSections
        sections={[
          {
            id: 's-global',
            titre: 'Reporting global',
            panneaux: [
              [
                { titre: '1. Reporting global', contenu: <TypesCharge d={d} lib={lib} /> },
              ],
            ],
          },
          {
            id: 's-sites',
            titre: 'Répartition par site',
            panneaux: [{ titre: '2. Répartition par site', contenu: <Sites d={d} lib={lib} /> }],
          },
          {
            id: 's-services',
            titre: 'Répartition par service et activité',
            panneaux: [{ titre: '3. Répartition par service et activité', contenu: <ServicesActivites d={d} lib={lib} /> }],
          },
          {
            id: 's-contrats',
            titre: 'Répartition par type de contrat et effectif',
            panneaux: [
              [
                { titre: '4. Répartition par nature de contrat', contenu: <Contrats d={d} lib={lib} /> },
                { titre: '5. Analyse des effectifs', contenu: <AnalyseEffectifs d={d} /> },
              ],
            ],
          },
          // Masqué tant qu'aucune donnée d'activité n'existe (activite null).
          ...(d.activite
            ? [{ id: 's-activite', titre: 'Activité', panneaux: [{ titre: '6. Activité', contenu: <Activite lignes={d.activite} lib={lib} /> }] }]
            : []),
        ]}
      />
    </>
  )
}
