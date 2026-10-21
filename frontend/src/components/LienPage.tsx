import { NavLink, useNavigate, type NavLinkProps } from 'react-router-dom'
import { transitionPage } from '../lib/mouvement'

/** NavLink qui change de page avec la transition de lib/mouvement.ts ; clic molette, Ctrl, Maj… gardent le comportement du navigateur. */
export default function LienPage({ onClick, ...props }: NavLinkProps) {
  const navigate = useNavigate()
  return (
    <NavLink
      {...props}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        transitionPage(() => navigate(props.to, { replace: props.replace, state: props.state }))
      }}
    />
  )
}
