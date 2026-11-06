import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

// Parcours de chaque profil sur la base de recette (tools/recette), remise à zéro au lancement.
const PY = process.platform === 'win32' ? '.venv\\Scripts\\python' : '.venv/bin/python'
const API_PORT = process.env.E2E_API_PORT || '8101'
const WEB_PORT = process.env.E2E_WEB_PORT || '5181'
const BASE = process.env.E2E_BASE || 'recette.db'
// Valeur tirée au hasard à chaque lancement ; `||=` garde la même valeur dans le processus principal et les workers.
process.env.E2E_SECRET_KEY ||= randomBytes(32).toString('hex')
const ENV_API = { DATABASE_URL: `sqlite:///${BASE}`, ENV: 'test', COOKIE_SECURE: 'false', SECRET_KEY: process.env.E2E_SECRET_KEY }

// Comptes de recette locaux (adresses et mots de passe générés, non suivis) : créés s'ils manquent.
if (!existsSync(resolve('../tools/recette/comptes.local.csv'))) {
  execFileSync(resolve('../backend', PY), ['../tools/recette/generer_comptes.py'], { cwd: resolve('../backend'), stdio: 'inherit' })
}

export default defineConfig({
  testDir: './e2e-recette',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}/`,
    headless: true,
    launchOptions: { executablePath: process.env.E2E_CHROMIUM || undefined },
  },
  webServer: [
    {
      command: `${PY} -W ignore ../tools/recette/reinit.py --base ${BASE} --fin 2026-06 && ${PY} -m uvicorn app.main:app --port ${API_PORT}`,
      cwd: '../backend',
      env: ENV_API,
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 300_000,
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
