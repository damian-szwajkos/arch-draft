import { lazy, StrictMode, Suspense, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import './index.css'
import { initTheme } from './lib/theme'
import { LandingPage } from './pages/LandingPage'
import { ScenariosPage } from './pages/ScenariosPage'
import { ConceptsPage, ConceptDetailPage } from './pages/ConceptsPage'
import { NotFound } from './pages/NotFound'
import { ErrorBoundary } from './components/ErrorBoundary'

initTheme()

const WorkspacePage = lazy(() => import('./pages/WorkspacePage').then((m) => ({ default: m.WorkspacePage })))

function Loading() {
  return (
    <div className="flex h-dvh items-center justify-center text-sm text-zinc-500">
      <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-brand-600" />
      Loading canvas…
    </div>
  )
}

/** Top-level error boundary; navigating to another route clears the error screen. */
function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <ScrollToTop />
      <RouteErrorBoundary>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/scenarios" element={<ScenariosPage />} />
          <Route path="/play/:id" element={<Suspense fallback={<Loading />}><WorkspacePage mode="scenario" /></Suspense>} />
          <Route path="/sandbox" element={<Suspense fallback={<Loading />}><WorkspacePage mode="sandbox" /></Suspense>} />
          <Route path="/concepts" element={<ConceptsPage />} />
          <Route path="/concepts/:id" element={<ConceptDetailPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </RouteErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
