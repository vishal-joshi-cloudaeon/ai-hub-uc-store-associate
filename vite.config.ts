import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const SERVER_PORT = process.env.PORT || 8787
const SERVER_ORIGIN = `http://localhost:${SERVER_PORT}`

// The Express server (server/src) serves this build from dist/public in
// production, so `base` stays '/' and the output lands next to the compiled
// server under dist/.
//
// In dev the SPA runs on Vite's own server and proxies the backend routes to
// the Express process, which keeps the frontend's API calls same-origin-
// relative in both dev and production — no environment-specific base URLs.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/agent': { target: SERVER_ORIGIN, changeOrigin: true },
      '/api': { target: SERVER_ORIGIN, changeOrigin: true },
      '/tools': { target: SERVER_ORIGIN, changeOrigin: true },
      '/healthz': { target: SERVER_ORIGIN, changeOrigin: true },
    },
  },
})
