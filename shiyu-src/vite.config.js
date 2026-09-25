import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isZhaohua = process.env.VITE_APP_VARIANT === 'zhaohua'

function variantAssets() {
  return {
    name: 'variant-assets',
    transformIndexHtml(html) {
      if (!isZhaohua) return html
      return html
        .replaceAll('拾羽记忆库', '昭华记忆库')
        .replaceAll('content="拾羽"', 'content="昭华"')
        .replace("localStorage.getItem('shiyu-store')", "localStorage.getItem('zhaohua-store')")
    },
    generateBundle() {
      if (!isZhaohua) return
      this.emitFile({
        type: 'asset', fileName: 'manifest.json',
        source: JSON.stringify({
          name: '昭华记忆库', short_name: '昭华', description: 'ChatGPT 与 Codex 的共同记忆',
          start_url: '.', scope: '.', display: 'standalone', orientation: 'portrait',
          background_color: '#F7F2EA', theme_color: '#F7F2EA',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        }, null, 2),
      })
      this.emitFile({
        type: 'asset', fileName: 'sw.js',
        source: "const CACHE='zhaohua-v1';self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('zhaohua-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)))})",
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), variantAssets()],
  base: `/ripple-and-serena/${isZhaohua ? 'zhaohua' : 'shiyu'}/`,
  build: {
    outDir: `../${isZhaohua ? 'zhaohua' : 'shiyu'}`,
    emptyOutDir: true,
  },
})
