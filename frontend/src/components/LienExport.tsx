import { urlExport, type FiltresPage } from '../api/rapports'

export default function LienExport({ rapport, filtres }: { rapport: 'mensuel' | 'annuel'; filtres: FiltresPage }) {
  return (
    <a className="bouton bouton-secondaire" href={urlExport(rapport, filtres)} download>
      Exporter (xlsx)
    </a>
  )
}
