/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// BASE_PATH lets the GitHub Pages workflow serve the app from /arch-draft/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  build: {
    // Scenario text is the bulk of the bundle; it gets its own long-lived chunk.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Long-lived vendor chunks + content chunks (scenarios / concept & tech catalog).
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react'
            if (id.includes('@xyflow')) return 'xyflow'
            return 'vendor'
          }
          if (id.includes('/src/data/scenarios/')) return 'scenarios'
          if (id.includes('/src/data/')) return 'catalog'
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
