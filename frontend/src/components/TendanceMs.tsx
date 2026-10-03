import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fcfa } from '../lib/format'

const AXE = { tickLine: false, axisLine: false, tick: { fill: '#6b6f82', fontSize: 12 } }

export default function TendanceMs({ points }: { points: { mois: string; ms: number }[] }) {
  return (
    <figure className="graphe graphe-fluide">
      <figcaption>Masse salariale mensuelle (FCFA)</figcaption>
      <div
        className="graphe-zone"
        role="img"
        aria-label="Courbe de la masse salariale par mois ; données détaillées dans le tableau ci-dessous"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points}>
            <CartesianGrid stroke="#e7e7ea" vertical={false} />
            <XAxis dataKey="mois" interval={0} padding={{ left: 12, right: 16 }} {...AXE} />
            <YAxis domain={[0, 'auto']} tickFormatter={(v) => fcfa(v)} width={90} {...AXE} />
            <Tooltip formatter={(v) => fcfa(Number(v))} />
            <Line dataKey="ms" name="Masse salariale" stroke="#3b5bdb" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}
