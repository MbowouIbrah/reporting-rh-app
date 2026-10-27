import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { type FiltresPage, getAnnuel } from '../api/rapports'
import type { Annuel as AnnuelData } from '../api/types'
import { AnalyseEffectifs, Contrats, RapportSquelette, ServicesActivites, Sites, TypesCharge, TypesExclus } from '../components/BlocsRapport'
import SnapSections from '../components/SnapSections'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode, { libelleComparaison } from '../components/FiltresPeriode'
import { useAttente } from '../hooks/useAttente'
import { useGabarit } from '../lib/gabarit'
import { useFiltres } from '../hooks/useFiltres'
import { useSalaries } from '../hooks/useSalaries'
import { entier, fcfa, MOIS } from '../lib/format'
import { TitreRapport } from '../components/ExportPdf'

function Contenu({ d, f }: { d: AnnuelData; f: FiltresPage }) {
  const { annee, mois } = f
  const lib = { prec: libelleComparaison(f, 'annee'), cour: `${annee}` }
  return (
    <>
      <p className="bandeau ok">
        <span>Cumul de janvier à {MOIS[mois - 1].toLowerCase()} {annee}</span>
        <span>Moyenne mensuelle : <strong className="val">{fcfa(d.moyenne_mensuelle.m)}</strong> ({entier(d.cumul_ytd.nb_mois)} mois)</span>
        {d.marge_ytd !== undefined && <span>Marge cumulée : <strong className="val">{fcfa(d.marge_ytd)}</strong> ({entier(d.nb_mois_marge ?? 0)} mois saisis)</span>}
      </p>
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
        ]}
      />
    </>
  )
}

export default function Annuel() {
  const f = useFiltres({ avecMois: false, comparaison: 'annee' })
  const salaries = useSalaries(f.filtres?.annee)
  const q = useQuery({
    queryKey: ['annuel', f.filtres],
    queryFn: () => getAnnuel(f.filtres!),
    enabled: !!f.filtres,
    placeholderData: keepPreviousData,
  })
  const [premier, relais] = useAttente(q.isLoading)
  const [maj] = useAttente(q.isPlaceholderData)
  const gab = useGabarit('annuel', q.data, !q.isPlaceholderData)
  // Premier chargement : la page à la forme de la dernière réponse, valeurs en squelette.
  const d = premier ? gab : q.data
  return (
    <section className={`page-ecran rapport-excel${maj ? ' maj' : ''}${relais ? ' relais' : ''}${premier && gab ? ' chargement' : ''}`} aria-busy={maj || premier || undefined}>
      <TitreRapport titre="REPORTING ANNUEL" />
      {f.filtres && (
        <FiltresPeriode avecMois={false} comparaison="annee" filtres={f.filtres} annees={f.annees} services={f.services} sites={f.sites} typesSite={f.typesSite} postes={f.postes} activites={f.activites} typesContrat={f.typesContrat} salaries={salaries} partage={f.partage} onChange={f.set} />
      )}
      {f.vide && <Etat type="vide" />}
      {premier && !gab && f.filtres && (
        <RapportSquelette
          lib={{ prec: libelleComparaison(f.filtres, 'annee'), cour: `${f.filtres.annee}` }}
          bandeau={
            <>
              <span>Cumul de janvier à {MOIS[f.filtres.mois - 1].toLowerCase()} {f.filtres.annee}</span>
              <span>Moyenne mensuelle : <strong className="val">—</strong></span>
              <span>Marge cumulée : <strong className="val">—</strong></span>
            </>
          }
        />
      )}
      {q.error && !premier && <Etat type={etatErreur(q.error)} />}
      {d && f.filtres && <Contenu d={d} f={f.filtres} />}
    </section>
  )
}
