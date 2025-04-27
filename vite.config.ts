import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Configure proxy for local development to talk to the worker
  server: {
    proxy: {
      // Proxy /api requests to the worker running locally
      // Make sure your worker is running via `npm run worker:dev`
      '/api': {
        target: 'http://localhost:8788', // Default port for `wrangler dev --local`
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''), // Remove /api prefix for the worker router
      },
    },
  },
  // Ensure the build output goes to 'dist' as specified in wrangler.toml
  build: {
    outDir: 'dist',
  },
})
