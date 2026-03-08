import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react-router') || id.includes('@tanstack/react-query') || id.includes('axios')) return 'app-data'
          if (id.includes('@radix-ui')) return 'radix-ui'
          if (id.includes('react-hook-form') || id.includes('@hookform/resolvers') || id.includes('zod')) return 'forms'
          if (id.includes('@dnd-kit')) return 'dnd-kit'
          if (id.includes('luxon')) return 'luxon'
          return 'vendor'
        }
      }
    }
  }
})
