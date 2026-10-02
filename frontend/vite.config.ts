declare const process: { env: Record<string, string | undefined> }
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/reporting-rh/',
  plugins: [react()],
  server: {
    proxy: {
      '/reporting-rh/api': {
        target: `http://localhost:${process.env.API_PORT || 8000}`,
        rewrite: (p) => p.replace('/reporting-rh/api', '/api'),
      },
    },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.ts'] },
})
