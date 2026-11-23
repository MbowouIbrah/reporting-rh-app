import { Navigate, useLocation } from 'react-router-dom'
import { indice, lireMois, texteMois } from '../lib/periode'

/** Ancienne page Mensuel (toujours en année civile) : année + mois deviennent la période, et la
 *  comparaison choisie la période comparée. Fait ici seulement : ailleurs, `annee` et `mois` sont
 *  des filtres partagés (admin) qui ne doivent pas fixer la période. */
export function depuisMensuel(search: string): string {
  const q = new URLSearchParams(search)
  const a = Number(q.get('annee'))
  const m = Number(q.get('mois'))
  if (Number.isInteger(a) && a > 0 && Number.isInteger(m) && m >= 1 && m <= 12 && !q.get('periode')) {
    q.set('periode', texteMois(indice(a, m)))
    const c = /^(\d{4})-(\d{1,2})$/.exec(q.get('cmp_periode') ?? '')
    const cm = c ? lireMois(`${c[1]}-${c[2].padStart(2, '0')}`) : null
    if (cm !== null && !q.get('comparee')) q.set('comparee', texteMois(cm))
    q.delete('mois')
    q.delete('cmp_periode')
  }
  const t = q.toString()
  return t ? `?${t}` : ''
}

/** Anciennes pages Annuel et Mensuel : les filtres de l'adresse suivent vers la répartition des charges. */
export default function VersCharges() {
  const { pathname, search } = useLocation()
  return <Navigate to={`/charges${pathname === '/mensuel' ? depuisMensuel(search) : search}`} replace />
}
