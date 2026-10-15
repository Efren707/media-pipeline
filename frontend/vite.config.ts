import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The dev server proxies /api to Spring Boot, so the backend needs no CORS setup.
// Port 5173 must stay in MP_CORS_ORIGINS, because the browser PUTs straight to S3.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Override with MP_API_URL if 8080 is taken (e.g. SERVER_PORT=8081 on the backend).
      '/api': process.env.MP_API_URL ?? 'http://localhost:8080',
    },
  },
})
