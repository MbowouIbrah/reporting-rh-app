import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { type FiltresPage, getAnnuel } from '../api/rapports'
import type { Annuel as AnnuelData } from '../api/types'
import { Activite, AnalyseEffectifs, Contrats, RapportSquelette, ServicesActivites, Sites, TypesCharge, TypesExclus } from '../components/BlocsRapport'
import SnapSections from '../components/SnapSections'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode, { libelleComparaison } from '../components/FiltresPeriode'
import { useAttente } from '../hooks/useAttente'
import { useGabarit } from '../lib/gabarit'
import { useFiltres } from '../hooks/useFiltres'
import { useSalaries } from '../hooks/useSalaries'
import { libelleExercice } from '../lib/exercice'
import { TitreRapport } from '../components/ExportPdf'

function Contenu({ d, f }: { d: AnnuelData; f: FiltresPage }) {
  const { annee, calendrier } = f
  const lib = { prec: libelleComparaison(f, 'annee'), cour: libelleExercice(annee, calendrier) }
  return (
    <>
      <SnapSections
        sections={[
          {
            id: 's-global',
            titre: 'Reporting global',
            panneaux: [
              [
                { titre: '1. Reporting global', contenu: <TypesCharge d={d} lib={lib} /> },
                { titre: 'Charges exclues du total', contenu: <TypesExclus d={d} lib={lib} /> },
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

export default function Annuel() {
  const f = useFiltres({ avecMois: false, comparaison: 'annee', avecCalendrier: true })
  const salaries = useSalaries(f.filtres?.annee, f.filtres?.calendrier)
  const q = useQuery({
    queryKey: ['annuel', f.filtres],
    queryFn: () => getAnnuel(f.filtres!),
    enabled: !!f.filtres,
    placeholderData: keepPreviousData,
  })
  const [premier, relais] = useAttente(q.isLoading)
  const [maj, relaisMaj] = useAttente(q.isPlaceholderData)
  const gab = useGabarit('annuel', q.data, !q.isPlaceholderData)
  // Premier chargement : la page à la forme de la dernière réponse, valeurs en squelette.
  const d = premier ? gab : q.data
  return (
    <section className={`page-ecran rapport-excel${maj ? ' maj' : ''}${relais || relaisMaj ? ' relais' : ''}${premier && gab ? ' chargement' : ''}`} aria-busy={maj || premier || undefined}>
      <TitreRapport titre="REPORTING ANNUEL" />
      {f.filtres && (
        <FiltresPeriode avecMois={false} comparaison="annee" avecCalendrier filtres={f.filtres} annees={f.annees} services={f.services} sites={f.sites} typesSite={f.typesSite} postes={f.postes} activites={f.activites} typesContrat={f.typesContrat} salaries={salaries} partage={f.partage} onChange={f.set} />
      )}
      {f.vide && <Etat type="vide" />}
      {premier && !gab && f.filtres && (
        <RapportSquelette
          lib={{ prec: libelleComparaison(f.filtres, 'annee'), cour: libelleExercice(f.filtres.annee, f.filtres.calendrier) }}
        />
      )}
      {q.error && !premier && <Etat type={etatErreur(q.error)} />}
      {d && f.filtres && <Contenu d={d} f={f.filtres} />}
    </section>
  )
}
