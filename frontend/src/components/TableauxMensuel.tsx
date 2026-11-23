import type { Mensuel as MensuelData } from '../api/types'
import BandeauControles from './BandeauControles'
import { Activite, AnalyseEffectifs, Contrats, ServicesActivites, Sites, TypesCharge, TypesExclus } from './BlocsRapport'
import SnapSections from './SnapSections'

/** Tableaux du reporting d'un mois (aperçu d'un lot de saisie), avec le bandeau des contrôles de cohérence en écart. */
export default function TableauxMensuel({ d, lib }: { d: MensuelData; lib: { prec: string; cour: string } }) {
  return (
    <>
      <BandeauControles controles={d.controles} />
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
            panneaux: [{ titre: '2. Répartition par site', sansTitre: true, contenu: <Sites d={d} lib={lib} titre="2. Répartition par site" /> }],
          },
          {
            id: 's-services',
            titre: 'Répartition par service et activité',
            panneaux: [{ titre: '3. Répartition par service et activité', sansTitre: true, contenu: <ServicesActivites d={d} lib={lib} titre="3. Répartition par service et activité" /> }],
          },
          // Masqué tant qu'aucune donnée d'activité n'existe (activite null).
          ...(d.activite
            ? [{ id: 's-activite', titre: 'Activité', panneaux: [{ titre: '4. Activité', sansTitre: true, contenu: <Activite lignes={d.activite} lib={lib} titre="4. Activité" /> }] }]
            : []),
          {
            id: 's-contrats',
            titre: 'Répartition par type de contrat et effectif',
            panneaux: [
              [
                { titre: '5. Répartition par nature de contrat', sansTitre: true, contenu: <Contrats d={d} lib={lib} titre="5. Répartition par nature de contrat" /> },
                { titre: '6. Analyse des effectifs', contenu: <AnalyseEffectifs d={d} fb={d.synthese.front_back} /> },
              ],
            ],
          },
        ]}
      />
    </>
  )
}
