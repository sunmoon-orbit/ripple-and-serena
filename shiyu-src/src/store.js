import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 前端本地锁的简单哈希（非加密强度，只为不把明文密码存在 localStorage）
export function hashPassword(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return 'h' + h.toString(16)
}

export const useStore = create(
  persist(
    (set) => ({
      // ── 后端连接 ──
      baseUrl: 'https://memory.ravenlove.cc',
      apiToken: '',
      fetchLimit: 100,
      setConn: (p) => set(p),

      // ── 主题 ──
      theme: 'light',
      toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),

      // ── 前端密码（本地锁）──
      passwordHash: null,
      setPassword: (pw) => set({ passwordHash: pw ? hashPassword(pw) : null }),

      // ── 当前面板 ──
      panel: 'memory',
      setPanel: (panel) => set({ panel }),
    }),
    {
      name: 'shiyu-store',
      partialize: (s) => ({
        baseUrl: s.baseUrl,
        apiToken: s.apiToken,
        fetchLimit: s.fetchLimit,
        theme: s.theme,
        passwordHash: s.passwordHash,
      }),
    }
  )
)
