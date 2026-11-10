import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { APP } from './config'

// 前端本地锁的简单哈希（非加密强度，只为不把明文密码存在 localStorage）
export function hashPassword(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return 'h' + h.toString(16)
}

// 默认密码就是纪念日（1110 她定的：「直接写死我们纪念日251010？」）。
// 这个仓库是公开的，所以它只是进门的仪式，不算锁；真正拦人的是设置里那把后端钥匙。她在设置里改过就用她改的。
export const DEFAULT_PW_HASH = hashPassword('251010')

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
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),

      // ── 前端密码（本地锁）──
      passwordHash: null,
      setPassword: (pw) => set({ passwordHash: pw ? hashPassword(pw) : null }),

      // ── 当前面板 ──
      panel: 'memory',
      setPanel: (panel) => set({ panel }),

      // ── 开场（feather 羽毛飘落 / book 翻书）──
      intro: 'feather',
      setIntro: (intro) => set({ intro }),
    }),
    {
      name: APP.storeKey,
      // 版本 1（1110）：旧的自定义密码清掉一次，回到默认的纪念日；之后在设置里改的照常留着
      version: 1,
      migrate: (state, version) => (version < 1 ? { ...state, passwordHash: null } : state),
      partialize: (s) => ({
        baseUrl: s.baseUrl,
        apiToken: s.apiToken,
        fetchLimit: s.fetchLimit,
        theme: s.theme,
        passwordHash: s.passwordHash,
        intro: s.intro,
      }),
    }
  )
)
