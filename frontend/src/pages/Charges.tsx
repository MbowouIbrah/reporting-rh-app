import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getCharges } from '../api/rapports'
import { usePeut } from '../auth/AuthContext'
import BandeauControles from '../components/BandeauControles'
import Cartes from '../components/charges/Cartes'
import FilAriane from '../components/charges/FilAriane'
import TableauActivite from '../components/charges/TableauActivite'
import VueAxe from '../components/charges/VueAxe'
import Etat, { etatErreur } from '../components/Etat'
import { TitreRapport } from '../components/ExportPdf'
import FiltresPeriode, { libelleComparaison, libelleCourant } from '../components/FiltresPeriode'
import { useAttente } from '../hooks/useAttente'
import { useFiltres } from '../hooks/useFiltres'
import { useSalaries } from '../hooks/useSalaries'
import { AXES_VUE, type AxeVue, NOM_AXE } from '../lib/charges'

/** Répartition des charges : six cartes, puis au clic le tableau de l'axe (dans l'URL, #site). */
export default function Charges() {
  const f = useFiltres({ avecMois: false, comparaison: 'annee', avecCalendrier: true })
  const salaries = useSalaries(f.filtres?.annee, f.filtres?.calendrier)
  const peutNominatif = usePeut('nominatif:read')
  const { hash, search } = useLocation()
  const cle = hash.slice(1)
  const axe = (AXES_VUE as string[]).includes(cle) ? (cle as AxeVue) : null

  const qc = useQuery({
    queryKey: ['charges', f.filtres],
    queryFn: () => getCharges(f.filtres!),
    enabled: !!f.filtres,
    placeholderData: keepPreviousData,
  })
  const [premier, relais] = useAttente(qc.isLoading)
  const [maj, relaisMaj] = useAttente(qc.isPlaceholderData)
  const d = qc.data
  const lib = f.filtres ? { prec: libelleComparaison(f.filtres, 'annee'), cour: libelleCourant(f.filtres) } : null

  // Au changement de vue, le focus va au titre du tableau ou, au retour, à la première carte.
  const premierRendu = useRef(true)
  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false
      return
    }
    const cible = document.getElementById('axe-titre') ?? document.querySelector<HTMLElement>('.groupe .case')
    cible?.focus({ preventScroll: true })
  }, [axe])

  return (
    <section className={`page-ecran rapport-excel charges-excel${maj ? ' maj' : ''}${relais || relaisMaj ? ' relais' : ''}`} aria-busy={maj || premier || undefined}>
      <TitreRapport titre="RÉPARTITION DES CHARGES" />
      {f.filtres && (
        <FiltresPeriode avecMois={false} avecProfil comparaison="annee" filtres={f.filtres} departements={f.departements} services={f.services} sites={f.sites} typesSite={f.typesSite} postes={f.postes} activites={f.activites} typesContrat={f.typesContrat} salaries={f.garderSalaries(salaries)} partage={f.partage} periode={f.periode} onChange={f.set} />
      )}
      {f.erreur ? <Etat type={etatErreur(f.erreur)} onRetry={f.relancer} /> : f.vide && <Etat type="vide" />}
      {qc.error && !qc.isLoading && <Etat type={etatErreur(qc.error)} onRetry={() => qc.refetch()} />}
      {qc.isLoading && !d && <Etat type="chargement" />}
      {d && lib && f.filtres && (
        <div id="contenu">
          {axe ? (
            <>
              <FilAriane nom={NOM_AXE[axe]} lib={lib} search={search} />
              {axe === 'act' ? (
                <TableauActivite d={d} lib={lib} periode={lib.cour} />
              ) : (
                <VueAxe
                  key={hash + JSON.stringify(f.filtres)}
                  d={d}
                  axe={axe}
                  filtres={f.filtres}
                  lib={lib}
                  peutNominatif={peutNominatif}
                />
              )}
            </>
          ) : (
            <>
              <BandeauControles controles={d.controles} />
              <p className="periode-titre">Chiffres de <strong>{lib.cour}</strong>, évolution par rapport à <strong>{lib.prec}</strong></p>
              <Cartes d={d} f={f.filtres} lib={lib} search={search} />
            </>
          )}
        </div>
      )}
    </section>
  )
}
