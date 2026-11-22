import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const target = process.env.LAB02_SERVER ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(process.env.BUILD_ID ? `web-${process.env.BUILD_ID}` : 'web-dev') },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': target,
      '/pack-art': target,
      '/healthz': target,
      '/ws': { target: target.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 900 },
})
