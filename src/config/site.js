export const SITE_NAME = 'Qriovo'
export const SITE_URL = __QRIOVO_PUBLIC_SITE_URL__
export const OG_IMAGE_URL = `${SITE_URL}/og-image.png`

export function routeUrl(pathname) {
  if (pathname === '/') return `${SITE_URL}/`
  return `${SITE_URL}/#${pathname}`
}
