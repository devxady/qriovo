import { ArrowLeft, ArrowRight, QrCode, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, Eyebrow, MockQR } from '../components/UI.jsx'

export function NotFoundPage() {
  return <section className="not-found-page"><div className="container not-found-layout"><div className="not-found-copy"><Eyebrow>Well, this is a little unexpected</Eyebrow><span className="not-found-code">404</span><h1>This page took<br />a <em>wrong turn.</em></h1><p>We couldn't find the page you were looking for. Let's get you somewhere useful.</p><div className="not-found-actions"><Button to="/">Back to home <ArrowLeft size={16} /></Button><Button to="/generator" variant="dark">Create a QR code <ArrowRight size={16} /></Button></div></div><div className="not-found-art"><div className="not-found-ring ring-one" /><div className="not-found-ring ring-two" /><div className="not-found-qr"><MockQR size={190} seed="qriovo-not-found" /></div><span className="not-found-spark"><Sparkles size={21} /></span><span className="not-found-sticker"><QrCode size={20} /> LOST<br />IN THE<br />LINKS</span></div></div></section>
}
