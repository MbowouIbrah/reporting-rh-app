import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getMensuel } from '../api/rapports'
import type { Mensuel as MensuelData } from '../api/types'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode, { libelleComparaison } from '../components/FiltresPeriode'
import LienExport from '../components/LienExport'
import { AnalyseEffectifs, Contrats, RapportSquelette, ServicesActivites, Sites, TypesCharge, TypesExclus } from '../components/BlocsRapport'
import SnapSections from '../components/SnapSections'
import { useFiltres } from '../hooks/useFiltres'
import { useSalaries } from '../hooks/useSalaries'
import { entier, pct } from '../lib/format'

export default function Mensuel() {
  const f = useFiltres({ comparaison: 'periode' })
  const salaries = useSalaries(f.filtres?.annee)
  const q = useQuery({
    queryKey: ['mensuel', f.filtres],
    queryFn: () => getMensuel(f.filtres!),
    enabled: !!f.filtres,
    placeholderData: keepPreviousData,
  })
  const maj = q.isPlaceholderData

  return (
    <section className={maj ? 'page-ecran rapport-excel maj' : 'page-ecran rapport-excel'} aria-busy={maj || undefined}>
      <h2 className="bandeau-titre">REPORTING MENSUEL</h2>
      {f.filtres && (
        <FiltresPeriode comparaison="periode" periodes={f.periodes} filtres={f.filtres} annees={f.annees} services={f.services} sites={f.sites} typesSite={f.typesSite} postes={f.postes} salaries={salaries} partage={f.partage} onChange={f.set}>
          {q.data && <LienExport rapport="mensuel" filtres={f.filtres} />}
        </FiltresPeriode>
      )}
      {f.vide && <Etat type="vide" />}
      {q.isLoading && f.filtres && (
        <RapportSquelette
          lib={{ prec: libelleComparaison(f.filtres, 'periode'), cour: 'M' }}
          bandeau={
            <>
              <span>Contrôles de cohérence : <strong className="val">—</strong></span>
              <span>Effectif fin de mois : <strong className="val">—</strong></span>
              <span>Rotation : <strong className="val">—</strong></span>
              <span>Absentéisme : <strong className="val">—</strong></span>
            </>
          }
        />
      )}
      {q.error && <Etat type={etatErreur(q.error)} />}
      {q.data && f.filtres && <Contenu d={q.data} lib={{ prec: libelleComparaison(f.filtres, 'periode'), cour: 'M' }} />}
    </section>
  )
}

function Contenu({ d, lib }: { d: MensuelData; lib: { prec: string; cour: string } }) {
  const s = d.synthese
  const bloquants = d.controles.filter((c) => c.bloquant)
  return (
    <>
      <p className={bloquants.length ? 'bandeau ko' : 'bandeau ok'} role="status">
        <span>
          {bloquants.length
            ? `Contrôles en écart : ${bloquants.map((c) => c.controle).join(' ; ')}`
            : 'Contrôles de cohérence : OK'}
        </span>
        <span>Effectif fin de mois : <strong className="val">{entier(s.effectif.fin)}</strong></span>
        <span>Rotation : <strong className="val">{pct(s.taux_rotation)}</strong></span>
        <span>Absentéisme : <strong className="val">{pct(s.taux_absenteisme)}</strong></span>
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
                { titre: '4. Nature de contrat', contenu: <Contrats d={d} lib={lib} /> },
                { titre: '5. Analyse des effectifs', contenu: <AnalyseEffectifs d={d} /> },
              ],
            ],
          },
        ]}
      />
    </>
  )
}
