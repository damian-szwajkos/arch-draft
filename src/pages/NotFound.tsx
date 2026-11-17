import { Link } from 'react-router-dom'
import { SiteHeader } from '../components/SiteHeader'

export function NotFound() {
  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main className="mx-auto max-w-xl px-6 py-24 text-center">
        <p className="font-mono text-sm text-brand-600">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">This box isn’t on the diagram</h1>
        <p className="mt-3 text-zinc-500 dark:text-zinc-400">The page you’re looking for doesn’t exist. Maybe it was extracted into another service.</p>
        <Link to="/" className="btn-dark mt-8">
          Back home
        </Link>
      </main>
    </div>
  )
}
