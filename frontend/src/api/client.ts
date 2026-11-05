export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Objet `detail` renvoyé par l'API, quand il en porte un. */
    public info?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export const BASE = `${import.meta.env.BASE_URL}api/v1`

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

let onMotDePasseAChanger: () => void = () => {}
export function setMotDePasseAChangerHandler(fn: () => void) {
  onMotDePasseAChanger = fn
}

// /auth/me reste éligible : c'est lui qui restaure la session après expiration du jeton d'accès.
const SANS_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout']

let refreshing: Promise<boolean> | null = null
function refresh(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

async function detail(r: Response): Promise<[string, Record<string, unknown>?]> {
  try {
    const j = await r.json()
    const d = j.detail
    if (typeof d === 'string') return [d]
    if (d && typeof d.message === 'string') {
      const anos: { ligne?: number; colonne?: string; message: string }[] = d.anomalies ?? []
      const lignes = anos.slice(0, 5).map((a) => [a.ligne && `ligne ${a.ligne}`, a.colonne, a.message].filter(Boolean).join(' · '))
      return [[d.message, ...lignes, anos.length > 5 ? `… +${anos.length - 5} autres` : ''].filter(Boolean).join('\n'), d]
    }
    return [r.statusText]
  } catch {
    return [r.statusText]
  }
}

async function requete(path: string, init: RequestInit, retry: boolean): Promise<Response> {
  const headers = init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json', ...init.headers } : init.headers
  const r = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...init, headers })
  if (r.status === 401 && retry && !SANS_REFRESH.includes(path)) {
    if (await refresh()) return requete(path, init, false)
    // Un 401 sur /auth/me est traité par AuthContext ; vider le cache ici bloquerait la requête en cours.
    if (path !== '/auth/me') onUnauthorized()
  }
  if (!r.ok) {
    const [message, info] = await detail(r)
    if (r.status === 403 && info?.code === 'mot_de_passe_a_changer') onMotDePasseAChanger()
    throw new ApiError(r.status, message, info)
  }
  return r
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const r = await requete(path, init, retry)
  return (r.status === 204 ? undefined : await r.json()) as T
}

/** Fichier produit par l'API (requête POST, donc pas de simple lien) : enregistré sous `nom`. */
export async function telecharger(path: string, init: RequestInit, nom: string): Promise<void> {
  const url = URL.createObjectURL(await (await requete(path, init, true)).blob())
  const a = document.createElement('a')
  a.href = url
  a.download = nom
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url))
}

export const queryRetry = (n: number, e: unknown) =>
  !(e instanceof ApiError && e.status < 500) && n < 2
