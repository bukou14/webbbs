import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // ws-proxy.mjs (dev); in production it serves /api from the same origin.
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
})
