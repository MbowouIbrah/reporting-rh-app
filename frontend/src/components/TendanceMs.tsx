import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fcfa } from '../lib/format'

export default function TendanceMs({ points }: { points: { mois: string; ms: number }[] }) {
  return (
    <figure className="graphe" style={{ marginBottom: 16 }}>
      <figcaption>Masse salariale mensuelle (FCFA)</figcaption>
      <div
        style={{ height: 200 }}
        role="img"
        aria-label="Courbe de la masse salariale par mois ; données détaillées dans le tableau ci-dessous"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points}>
            <CartesianGrid stroke="#e7e7ea" vertical={false} />
            <XAxis dataKey="mois" />
            <YAxis domain={['dataMin * 0.98', 'dataMax * 1.02']} tickFormatter={(v) => fcfa(v)} width={90} />
            <Tooltip formatter={(v) => fcfa(Number(v))} />
            <Line dataKey="ms" name="Masse salariale" stroke="#3b5bdb" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}
