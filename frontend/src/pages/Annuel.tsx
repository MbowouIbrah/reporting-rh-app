import { useQuery } from '@tanstack/react-query'
import { getAnnuel } from '../api/rapports'
import type { Annuel as AnnuelData } from '../api/types'
import { AnalyseEffectifs, Contrats, Panneau, ServicesActivites, Sites, TypesCharge } from '../components/BlocsRapport'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode from '../components/FiltresPeriode'
import LienExport from '../components/LienExport'
import { useFiltres } from '../hooks/useFiltres'
import { entier, fcfa, MOIS } from '../lib/format'

function Contenu({ d, annee, mois }: { d: AnnuelData; annee: number; mois: number }) {
  const lib = { prec: `${annee - 1}`, cour: `${annee}` }
  return (
    <>
      <p className="bandeau ok">
        <span>Cumul de janvier à {MOIS[mois - 1].toLowerCase()}</span>
        <span>Moyenne mensuelle : <strong>{fcfa(d.moyenne_mensuelle.m)}</strong></span>
        <span>Année {annee - 1} complète : <strong>{fcfa(d.cumul_annee_n1)}</strong></span>
        <span>Nb de mois saisis : <strong>{entier(d.cumul_ytd.nb_mois)}</strong> en {annee}, <strong>{entier(d.cumul_ytd.nb_mois_n1)}</strong> en {annee - 1}</span>
        {d.marge_ytd !== undefined && (
          <span>Marge cumulée : <strong>{fcfa(d.marge_ytd)}</strong> ({entier(d.nb_mois_marge)} mois avec CA)</span>
        )}
      </p>
      <div className="grille-rapport">
        <Panneau titre="1. Reporting global" className="p-global"><TypesCharge d={d} lib={lib} /></Panneau>
        <Panneau titre="2. Répartition par service et activité" className="p-service"><ServicesActivites d={d} lib={lib} /></Panneau>
        <Panneau titre="3. Répartition par site" className="p-site"><Sites d={d} lib={lib} /></Panneau>
        <Panneau titre="4. Analyse des effectifs" className="p-effectifs"><AnalyseEffectifs d={d} /></Panneau>
        <Panneau titre="5. Nature de contrat" className="p-contrat"><Contrats d={d} lib={lib} /></Panneau>
      </div>
    </>
  )
}

export default function Annuel() {
  const f = useFiltres()
  const q = useQuery({
    queryKey: ['annuel', f.filtres],
    queryFn: () => getAnnuel(f.filtres!),
    enabled: !!f.filtres,
  })
  return (
    <section className="rapport-excel">
      <h2 className="bandeau-titre">COMPARATIF ANNUEL — Charges RH sur l’année</h2>
      {f.filtres && (
        <FiltresPeriode filtres={f.filtres} annees={f.annees} services={f.services} sites={f.sites} onChange={f.set}>
          {q.data && <LienExport rapport="annuel" filtres={f.filtres} />}
        </FiltresPeriode>
      )}
      {f.vide && <Etat type="vide" />}
      {q.isLoading && <Etat type="chargement" />}
      {q.error && <Etat type={etatErreur(q.error)} />}
      {q.data && f.filtres && <Contenu d={q.data} annee={f.filtres.annee} mois={f.filtres.mois} />}
    </section>
  )
}
