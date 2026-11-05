import { connexionRetablie, PANNE_PASSERELLE, verifierConnexion } from '../lib/etatConnexion'

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

/** Le serveur est injoignable : réseau coupé, passerelle sans réponse ou lecture trop longue. */
export class ErreurReseau extends Error {
  constructor() {
    super('Connexion au serveur impossible. Vérifiez le réseau, puis réessayez.')
  }
}

export const BASE = `${import.meta.env.BASE_URL}api/v1`

// Lecture la plus lente mesurée : 1,8 s. Les envois (imports, exports) n'ont pas de limite, sauf les
// envois courts ci-dessous : sans réponse, ils bloqueraient la déconnexion ou la saisie.
const DELAI_LECTURE = 30_000
const DELAI_ENVOI_COURT = 15_000
const ENVOIS_COURTS = ['/auth/login', '/auth/refresh', '/auth/logout', '/donnees/verifier']
// Réseau muet (sans événement `offline`) : la sonde part tôt pour annoncer la panne sans attendre le délai.
const ATTENTE_AVANT_SONDE = 8_000

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

/**
 * `fetch` dont toute panne devient une `ErreurReseau` et fait vérifier la connexion. Le corps est lu
 * ici, sous le même minuteur : une coupure pendant la réception est aussi une panne.
 */
async function appel(url: string, init: RequestInit, delai?: number): Promise<Response> {
  const ctrl = new AbortController()
  const appelant = init.signal
  const relayer = () => ctrl.abort()
  appelant?.addEventListener('abort', relayer)
  if (appelant?.aborted) ctrl.abort()
  const minuteur = delai ? setTimeout(() => ctrl.abort(), delai) : undefined
  const veille = setTimeout(() => void verifierConnexion(), ATTENTE_AVANT_SONDE)
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal })
    if (PANNE_PASSERELLE.includes(r.status)) throw new ErreurReseau()
    // arrayBuffer plutôt que blob : un corps lu en blob n'est plus lisible par les outils du navigateur.
    const corps = r.status === 204 || r.status === 205 ? null : await r.arrayBuffer()
    connexionRetablie()
    return new Response(corps, { status: r.status, statusText: r.statusText, headers: r.headers })
  } catch (e) {
    // Annulation demandée par l'appelant : ce n'est pas une panne.
    if (appelant?.aborted) throw e
    void verifierConnexion()
    throw e instanceof ErreurReseau ? e : new ErreurReseau()
  } finally {
    clearTimeout(minuteur)
    clearTimeout(veille)
    appelant?.removeEventListener('abort', relayer)
  }
}

let refreshing: Promise<boolean> | null = null
/**
 * Faux seulement quand le serveur refuse le renouvellement (4xx). Une panne ou une erreur serveur
 * rejette : elle ne dit rien de la session, qui reste ouverte.
 */
function refresh(): Promise<boolean> {
  refreshing ??= appel(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin' }, DELAI_ENVOI_COURT)
    .then((r) => {
      if (r.status >= 500) throw new ApiError(r.status, 'Le serveur a rencontré une erreur.')
      return r.ok
    })
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
  const lecture = !init.method || init.method === 'GET'
  const delai = lecture ? DELAI_LECTURE : ENVOIS_COURTS.includes(path) ? DELAI_ENVOI_COURT : undefined
  const r = await appel(`${BASE}${path}`, { credentials: 'same-origin', ...init, headers }, delai)
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
