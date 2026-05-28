import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/ripple-and-serena/shiyu/',
  build: {
    outDir: '../shiyu',
    emptyOutDir: true,
  },
})
