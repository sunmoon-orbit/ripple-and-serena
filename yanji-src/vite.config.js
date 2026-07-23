import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/ripple-and-serena/yanji/',
  // 构建时间戳（北京时间），设置页底部可见——终结「你手里到底是哪版」的猜谜（2026-07-23）
  define: {
    __BUILD_TIME__: JSON.stringify(
      new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' BJ'
    ),
  },
  build: {
    outDir: '../yanji',
    emptyOutDir: true,
    sourcemap: true,
  },
})
