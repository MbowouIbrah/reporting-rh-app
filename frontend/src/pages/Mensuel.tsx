import { useQuery } from '@tanstack/react-query'
import { getMensuel } from '../api/rapports'
import type { Mensuel as MensuelData } from '../api/types'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode from '../components/FiltresPeriode'
import LienExport from '../components/LienExport'
import { AnalyseEffectifs, Contrats, Panneau, ServicesActivites, Sites, TypesCharge } from '../components/BlocsRapport'
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
    <section className="rapport-excel">
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
      <div className="grille-rapport">
        <Panneau titre="1. Reporting global" className="p-global"><TypesCharge d={d} lib={LIB} /></Panneau>
        <Panneau titre="2. Répartition par service et activité" className="p-service"><ServicesActivites d={d} lib={LIB} /></Panneau>
        <Panneau titre="3. Répartition par site" className="p-site"><Sites d={d} lib={LIB} /></Panneau>
        <Panneau titre="4. Analyse des effectifs" className="p-effectifs"><AnalyseEffectifs d={d} /></Panneau>
        <Panneau titre="5. Nature de contrat" className="p-contrat"><Contrats d={d} lib={LIB} /></Panneau>
      </div>
    </>
  )
}
