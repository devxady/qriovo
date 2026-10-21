import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'

const root = process.cwd()
const config = JSON.parse(await readFile(resolve(root, 'site.config.json'), 'utf8'))
const env = loadEnv('production', root, 'VITE_')
const siteUrl = String(env.VITE_PUBLIC_SITE_URL || config.publicUrl).trim().replace(/\/+$/, '')
const parsedSiteUrl = new URL(siteUrl)
if (parsedSiteUrl.protocol !== 'https:' || /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i.test(parsedSiteUrl.hostname)) {
  throw new Error('SEO files require a public HTTPS VITE_PUBLIC_SITE_URL; localhost URLs are not allowed.')
}
const routeUrl = (pathname) => pathname === '/' ? `${siteUrl}/` : `${siteUrl}/#${pathname}`
const escapeXml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...config.publicRoutes.map((pathname) => `  <url><loc>${escapeXml(routeUrl(pathname))}</loc></url>`),
  '</urlset>',
  '',
].join('\n')

const robots = `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`
const publicDir = resolve(root, 'public')
await mkdir(publicDir, { recursive: true })
await Promise.all([
  writeFile(resolve(publicDir, 'robots.txt'), robots, 'utf8'),
  writeFile(resolve(publicDir, 'sitemap.xml'), sitemap, 'utf8'),
])
console.log(`Generated public/robots.txt and public/sitemap.xml for ${siteUrl}`)
