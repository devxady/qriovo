import { useEffect, useRef } from 'react'
import QRCodeStyling from 'qr-code-styling'

export function QRCodePreview({ data, options, label = 'Scannable QR code preview' }) {
  const mount = useRef(null)
  const code = useRef(null)
  const attached = useRef(null)

  useEffect(() => {
    if (!mount.current || !data) {
      code.current = null
      attached.current = null
      return
    }
    const nextOptions = { ...options, data }
    if (!code.current || attached.current !== mount.current) {
      code.current = new QRCodeStyling(nextOptions)
      code.current.append(mount.current)
      attached.current = mount.current
    } else {
      code.current.update(nextOptions)
    }
  }, [data, options])

  return <div className={`qr-code-mount ${data ? 'qr-code-ready' : ''}`} role="img" aria-label={data ? label : undefined}>
    {data ? <div className="qr-code-stage" ref={mount} /> : <div className="qr-empty-preview"><span>QR</span><small>Enter details to preview</small></div>}
  </div>
}
