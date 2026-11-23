import type { Controle } from '../api/types'

/** Contrôles de cohérence : signalés seulement en cas d'écart, rien quand tout est juste. */
export default function BandeauControles({ controles }: { controles?: Controle[] }) {
  const ecarts = (controles ?? []).filter((c) => c.bloquant)
  if (ecarts.length === 0) return null
  return (
    <p className="bandeau ko" role="alert">
      Contrôles de cohérence en écart : {ecarts.map((c) => c.controle).join(' ; ')}
    </p>
  )
}
