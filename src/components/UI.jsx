import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUpRight, Check, Copy, Download, ExternalLink, Leaf, Sparkles } from 'lucide-react'

export function Brand({ light = false, compact = false }) {
  const logoFile = light ? 'logo-02.webp' : 'logo-01.webp'
  return <Link className={`brand ${light ? 'brand-light' : ''} ${compact ? 'brand-compact' : ''}`} to="/" aria-label="Qriovo home"><img className="brand-logo" src={`${import.meta.env.BASE_URL}${logoFile}`} alt="" aria-hidden="true" /></Link>
}

export function Button({ children, to, href, variant = 'primary', className = '', ...props }) {
  const classes = `button button-${variant} ${className}`
  if (to) return <Link className={classes} to={to} {...props}>{children}</Link>
  if (href) return <a className={classes} href={href} {...props}>{children}</a>
  return <button className={classes} {...props}>{children}</button>
}

export function Eyebrow({ children, icon = true, className = '' }) {
  return <span className={`eyebrow ${className}`}>{icon && <span className="eyebrow-dot" />}{children}</span>
}

export function SectionTitle({ eyebrow, title, children, light = false, align = 'left' }) {
  return <div className={`section-title ${light ? 'on-dark' : ''} text-${align}`}>{eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}<h2>{title}</h2>{children && <p>{children}</p>}</div>
}

function finder(x, y, ox, oy) {
  const dx = x - ox; const dy = y - oy
  if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return null
  if (dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)) return true
  return false
}

export function MockQR({ size = 180, tone = 'forest', seed = 'qriovo', showFrame = false }) {
  const modules = useMemo(() => {
    const count = 29
    const cells = []
    for (let y = 0; y < count; y += 1) {
      for (let x = 0; x < count; x += 1) {
        const finders = [[1, 1], [21, 1], [1, 21]]
        const fixed = finders.map(([ox, oy]) => finder(x, y, ox, oy)).find((v) => v !== null && v !== undefined)
        let value = fixed
        if (value === undefined) {
          let n = seed.length * 97 + x * 374761393 + y * 668265263
          n = (n ^ (n >>> 13)) * 1274126177
          value = ((n ^ (n >>> 16)) >>> 0) % 100 < 47
          if (x === 8 || y === 8 || x === 20 || y === 20) value = (x + y) % 2 === 0
        }
        if (value) cells.push(<rect key={`${x}-${y}`} x={x + 2} y={y + 2} width="1" height="1" rx=".1" />)
      }
    }
    return cells
  }, [seed])
  return <div className={`mock-qr ${showFrame ? 'mock-qr-framed' : ''}`} style={{ '--qr-size': `${size}px` }} aria-label="Decorative QR code preview"><svg className={`qr-svg qr-${tone}`} viewBox="0 0 33 33" role="img" aria-hidden="true"><rect className="qr-bg" width="33" height="33" rx="2" />{modules}</svg></div>
}

export function IconBadge({ children, tone = 'lime' }) { return <span className={`icon-badge icon-badge-${tone}`}>{children}</span> }

export function Notice({ children, tone = 'info' }) { return <div className={`notice notice-${tone}`} role="status">{children}</div> }

export function FeatureItem({ icon, title, children }) {
  return <div className="feature-item"><IconBadge>{icon || <Sparkles size={20} />}</IconBadge><div><h3>{title}</h3><p>{children}</p></div></div>
}

export function TinyMetric({ value, label, icon }) { return <div className="tiny-metric"><span className="tiny-metric-icon">{icon || <Leaf size={17} />}</span><strong>{value}</strong><span>{label}</span></div> }

export function LinkArrow({ to, children }) { return <Link className="text-link" to={to}>{children}<ArrowUpRight size={16} /></Link> }

export function ComingSoonButton({ children, variant = 'secondary' }) {
  return <Button type="button" variant={variant} onClick={() => window.dispatchEvent(new CustomEvent('qriovo-placeholder', { detail: 'This action will be available when account and QR services are connected.' }))}>{children}</Button>
}

export function QRActionLabel({ children, icon = 'download' }) {
  const Icon = icon === 'copy' ? Copy : icon === 'external' ? ExternalLink : icon === 'up' ? ArrowUp : icon === 'check' ? Check : Download
  return <><Icon size={16} />{children}</>
}
