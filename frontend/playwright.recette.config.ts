import { defineConfig } from '@playwright/test'

// Parcours de chaque profil sur la base de recette (tools/recette), remise à zéro au lancement.
const PY = process.platform === 'win32' ? '.venv\\Scripts\\python' : '.venv/bin/python'
const API_PORT = process.env.E2E_API_PORT || '8101'
const WEB_PORT = process.env.E2E_WEB_PORT || '5181'
const ENV_API = { DATABASE_URL: 'sqlite:///recette.db', ENV: 'test', COOKIE_SECURE: 'false', COOKIE_PATH_PREFIX: '/reporting-rh', SECRET_KEY: '<cle-de-test>' }

export default defineConfig({
  testDir: './e2e-recette',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}/reporting-rh/`,
    headless: true,
    launchOptions: { executablePath: process.env.E2E_CHROMIUM || undefined },
  },
  webServer: [
    {
      command: `${PY} -W ignore ../tools/recette/reinit.py && ${PY} -m uvicorn app.main:app --port ${API_PORT}`,
      cwd: '../backend',
      env: ENV_API,
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
    {
      command: 'npx vite --port ' + WEB_PORT + ' --strictPort',
      env: { API_PORT },
      url: `http://localhost:${WEB_PORT}/reporting-rh/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
