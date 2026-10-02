export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

const BASE = `${import.meta.env.BASE_URL}api/v1`

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

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

async function detail(r: Response): Promise<string> {
  try {
    const j = await r.json()
    return typeof j.detail === 'string' ? j.detail : r.statusText
  } catch {
    return r.statusText
  }
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers
  const r = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...init, headers })
  if (r.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refresh()) return api<T>(path, init, false)
    onUnauthorized()
  }
  if (!r.ok) throw new ApiError(r.status, await detail(r))
  return (r.status === 204 ? undefined : await r.json()) as T
}

export const queryRetry = (n: number, e: unknown) =>
  !(e instanceof ApiError && e.status < 500) && n < 2
