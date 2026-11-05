declare const process: { env: Record<string, string | undefined> }
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT || 8000}`,
      },
    },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.ts'] },
})
