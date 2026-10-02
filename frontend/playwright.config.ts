import { defineConfig } from '@playwright/test'

const BACKEND = '../backend'
const PY = process.platform === 'win32' ? '.venv\\Scripts\\python' : '.venv/bin/python'
const DB = 'sqlite:///e2e.db'
const ENV_API = { DATABASE_URL: DB, ENV: 'test', COOKIE_SECURE: 'false', COOKIE_PATH_PREFIX: '/reporting-rh', SECRET_KEY: '<cle-de-test>' }

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  reporter: 'dot',
  use: {
    baseURL: 'http://localhost:5173/reporting-rh/',
    headless: true,
    launchOptions: { executablePath: process.env.E2E_CHROMIUM || undefined },
  },
  webServer: [
    {
      command: `${PY} ../tools/e2e_seed.py && ${PY} -m uvicorn app.main:app --port 8000`,
      cwd: BACKEND,
      env: ENV_API,
      url: 'http://localhost:8000/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      url: 'http://localhost:5173/reporting-rh/',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
