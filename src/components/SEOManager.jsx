import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { OG_IMAGE_URL, SITE_NAME, routeUrl } from '../config/site.js'

const routeMetadata = {
  '/': {
    title: 'Free QR Code Generator — Create, Customize & Save | Qriovo',
    description: 'Create and customize QR codes for free, with no signup required. Download as a guest or create an account to save, edit, duplicate, and manage your codes.',
  },
  '/generator': {
    title: 'Free QR Code Generator & Customizer | Qriovo',
    description: 'Create QR codes for websites, Wi-Fi, contact details, and more. Customize and download without signing up, or sign in to save a code.',
  },
  '/about': {
    title: 'About Qriovo | Thoughtfully Made QR Codes',
    description: 'Learn about Qriovo’s approach to making QR codes simple to create, customize, preview, and save when you choose an account.',
  },
  '/contact': {
    title: 'Contact Qriovo | Questions and Feedback',
    description: 'Contact Qriovo with a question, suggestion, or issue. The contact form opens a draft in your email app and does not send or store it.',
  },
  '/privacy-policy': {
    title: 'Privacy Policy | Qriovo',
    description: 'Read how Qriovo handles account profiles, saved QR code content, Firebase Authentication, Firestore, and contact form drafts.',
  },
  '/terms-and-conditions': {
    title: 'Terms and Conditions | Qriovo',
    description: 'Review the terms for using Qriovo to create, customize, download, and manage static QR codes.',
  },
  '/login': {
    title: 'Log In to Qriovo',
    description: 'Log in to manage the QR codes saved to your Qriovo account.',
    noindex: true,
  },
  '/register': {
    title: 'Create a Free Qriovo Account',
    description: 'Create a Qriovo account to save, edit, duplicate, download, and manage your QR codes.',
    noindex: true,
  },
}

const privateMetadata = {
  dashboard: { title: 'Your QR Code Dashboard | Qriovo', description: 'Manage QR codes saved to your Qriovo account.', noindex: true },
  edit: { title: 'Edit a Saved QR Code | Qriovo', description: 'Edit a QR code saved to your Qriovo account.', noindex: true },
  admin: { title: 'Super Admin Console | Qriovo', description: 'Restricted Qriovo account monitoring console.', noindex: true },
  notFound: { title: 'Page Not Found | Qriovo', description: 'The requested Qriovo page could not be found.', noindex: true },
}

function metadataFor(pathname) {
  if (routeMetadata[pathname]) return routeMetadata[pathname]
  if (/^\/dashboard\/qr\/[^/]+\/edit\/?$/.test(pathname)) return privateMetadata.edit
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return privateMetadata.dashboard
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return privateMetadata.admin
  return privateMetadata.notFound
}

function setMeta(attribute, key, content) {
  let meta = document.head.querySelector(`meta[${attribute}="${key}"]`)
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute(attribute, key)
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', content)
}

function setCanonical(url) {
  let link = document.head.querySelector('link[rel="canonical"]')
  if (!url) {
    link?.remove()
    return
  }
  if (!link) {
    link = document.createElement('link')
    link.rel = 'canonical'
    document.head.appendChild(link)
  }
  link.href = url
}

export function SEOManager() {
  const { pathname } = useLocation()
  const normalizedPathname = pathname === '/' ? '/' : pathname.replace(/\/+$/, '')

  useEffect(() => {
    const page = metadataFor(normalizedPathname)
    const url = routeUrl(normalizedPathname)
    const imageAlt = 'Qriovo logo with the message: Create for free. Save with an account.'
    document.title = page.title
    setMeta('name', 'description', page.description)
    setMeta('name', 'robots', page.noindex ? 'noindex, nofollow' : 'index, follow')
    setMeta('property', 'og:site_name', SITE_NAME)
    setMeta('property', 'og:type', 'website')
    setMeta('property', 'og:title', page.title)
    setMeta('property', 'og:description', page.description)
    setMeta('property', 'og:url', url)
    setMeta('property', 'og:image', OG_IMAGE_URL)
    setMeta('property', 'og:image:type', 'image/png')
    setMeta('property', 'og:image:width', '1200')
    setMeta('property', 'og:image:height', '630')
    setMeta('property', 'og:image:alt', imageAlt)
    setMeta('name', 'twitter:card', 'summary_large_image')
    setMeta('name', 'twitter:title', page.title)
    setMeta('name', 'twitter:description', page.description)
    setMeta('name', 'twitter:image', OG_IMAGE_URL)
    setMeta('name', 'twitter:image:alt', imageAlt)
    setCanonical(page.noindex ? null : url)
  }, [normalizedPathname])

  return null
}
