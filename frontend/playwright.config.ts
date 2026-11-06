import { randomBytes } from 'node:crypto'
import { defineConfig } from '@playwright/test'

const BACKEND = '../backend'
const PY = process.platform === 'win32' ? '.venv\\Scripts\\python' : '.venv/bin/python'
const API_PORT = process.env.E2E_API_PORT || '8000'
const WEB_PORT = process.env.E2E_WEB_PORT || '5173'
const DB = 'sqlite:///e2e.db'
// Valeurs tirées au hasard à chaque lancement ; `||=` garde la même valeur dans le processus principal et les workers.
process.env.E2E_SECRET_KEY ||= randomBytes(32).toString('hex')
process.env.E2E_PASSWORD ||= 't-' + randomBytes(12).toString('hex')
const ENV_API = {
  DATABASE_URL: DB, ENV: 'test', COOKIE_SECURE: 'false',
  SECRET_KEY: process.env.E2E_SECRET_KEY, E2E_PASSWORD: process.env.E2E_PASSWORD,
}

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  reporter: 'dot',
  use: {
    baseURL: `http://localhost:${WEB_PORT}/`,
    headless: true,
    launchOptions: { executablePath: process.env.E2E_CHROMIUM || undefined },
  },
  webServer: [
    {
      command: `${PY} ../tools/e2e_seed.py && ${PY} -m uvicorn app.main:app --port ${API_PORT}`,
      cwd: BACKEND,
      env: ENV_API,
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npx vite --port ' + WEB_PORT + ' --strictPort',
      env: { API_PORT },
      url: `http://localhost:${WEB_PORT}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
