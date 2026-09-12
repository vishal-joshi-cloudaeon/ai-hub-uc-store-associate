import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Databricks Apps serves the built frontend from the app root, so base
// stays '/' and the build output is pointed at frontend/dist for the
// Databricks Apps deployment layout.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'frontend/dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
})
