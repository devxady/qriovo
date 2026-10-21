import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const siteConfig = JSON.parse(readFileSync(new URL('./site.config.json', import.meta.url), 'utf8'))

function normalizeSiteUrl(value) {
  return String(value || siteConfig.publicUrl).trim().replace(/\/+$/, '')
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const publicSiteUrl = normalizeSiteUrl(env.VITE_PUBLIC_SITE_URL)
  const parsedSiteUrl = new URL(publicSiteUrl)
  if (command === 'build' && (parsedSiteUrl.protocol !== 'https:' || /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i.test(parsedSiteUrl.hostname))) {
    throw new Error('Production SEO metadata requires a public HTTPS VITE_PUBLIC_SITE_URL; localhost URLs are not allowed.')
  }

  return {
    plugins: [react(), {
      name: 'qriovo-seo-url-placeholder',
      transformIndexHtml(html) {
        return html.replaceAll('%QRIOVO_PUBLIC_SITE_URL%', publicSiteUrl)
      },
    }],
    define: { __QRIOVO_PUBLIC_SITE_URL__: JSON.stringify(publicSiteUrl) },
    base: command === 'build' ? siteConfig.basePath : '/',
    resolve: {
      dedupe: ['@firebase/app'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const path = id.replace(/\\/g, '/')
            if (path.includes('/node_modules/@firebase/auth/')) return 'firebase-auth'
            if (path.includes('/node_modules/@firebase/firestore/')) return 'firebase-firestore'
            if (path.includes('/node_modules/@firebase/app/')) return 'firebase-app'
            if (path.includes('/node_modules/@firebase/')) return 'firebase-shared'
            if (path.includes('/node_modules/firebase/')) return 'firebase-entry'
            if (path.includes('/node_modules/qr-code-styling/') || path.includes('/node_modules/qrcode-generator/')) return 'qr-vendor'
            if (path.includes('/node_modules/react/') || path.includes('/node_modules/react-dom/') || path.includes('/node_modules/scheduler/')) return 'react-vendor'
          },
        },
      },
    },
  }
})
