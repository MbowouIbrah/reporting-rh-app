import { useQuery } from '@tanstack/react-query'
import { getMensuel } from '../api/rapports'
import type { Mensuel as MensuelData } from '../api/types'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode from '../components/FiltresPeriode'
import LienExport from '../components/LienExport'
import { AnalyseEffectifs, Contrats, ServicesActivites, Sites, TypesCharge } from '../components/BlocsRapport'
import SnapSections from '../components/SnapSections'
import { useFiltres } from '../hooks/useFiltres'
import { entier, pct } from '../lib/format'

const LIB = { prec: 'M-1', cour: 'M' }

export default function Mensuel() {
  const f = useFiltres()
  const q = useQuery({
    queryKey: ['mensuel', f.filtres],
    queryFn: () => getMensuel(f.filtres!),
    enabled: !!f.filtres,
  })

  return (
    <section className="page-ecran rapport-excel">
      <h2 className="bandeau-titre">REPORTING MENSUEL — Charges RH par période</h2>
      {f.filtres && (
        <FiltresPeriode filtres={f.filtres} annees={f.annees} services={f.services} sites={f.sites} onChange={f.set}>
          {q.data && <LienExport rapport="mensuel" filtres={f.filtres} />}
        </FiltresPeriode>
      )}
      {f.vide && <Etat type="vide" />}
      {q.isLoading && <Etat type="chargement" />}
      {q.error && <Etat type={etatErreur(q.error)} />}
      {q.data && f.filtres && <Contenu d={q.data} />}
    </section>
  )
}

function Contenu({ d }: { d: MensuelData }) {
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
        <span>Effectif fin de mois : <strong>{entier(s.effectif.fin)}</strong></span>
        <span>Rotation : <strong>{pct(s.taux_rotation)}</strong></span>
        <span>Absentéisme : <strong>{pct(s.taux_absenteisme)}</strong></span>
      </p>
      <SnapSections
        sections={[
          {
            id: 's-global',
            titre: 'Reporting global',
            panneaux: [{ titre: '1. Reporting global', contenu: <TypesCharge d={d} lib={LIB} /> }],
          },
          {
            id: 's-service',
            titre: 'Services et effectifs',
            colonnes: '1.6fr 1fr',
            panneaux: [
              { titre: '2. Répartition par service et activité', contenu: <ServicesActivites d={d} lib={LIB} /> },
              { titre: '4. Analyse des effectifs', contenu: <AnalyseEffectifs d={d} /> },
            ],
          },
          {
            id: 's-site',
            titre: 'Sites et contrats',
            colonnes: '1.5fr 1fr',
            panneaux: [
              { titre: '3. Répartition par site', contenu: <Sites d={d} lib={LIB} /> },
              { titre: '5. Nature de contrat', contenu: <Contrats d={d} lib={LIB} /> },
            ],
          },
        ]}
      />
    </>
  )
}
