/** Arrière-plan commun : photo floutée, voile blanc (lisibilité), halo et grain. Purement décoratif. */
export default function Fond() {
  return (
    <div className="fond" aria-hidden="true">
      <img src={`${import.meta.env.BASE_URL}images/fond.webp`} alt="" />
      <div className="fond-voile" />
      <div className="fond-grain" />
    </div>
  )
}
