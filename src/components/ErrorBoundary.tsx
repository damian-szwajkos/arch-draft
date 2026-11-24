import { Component, type ErrorInfo, type ReactNode } from 'react'

const WS_PREFIX = 'archdraft:ws:'

/** Storage key of the workspace for the current URL (if the crash happened inside one). */
function workspaceKeyForPath(pathname: string): string | undefined {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const path = pathname.startsWith(base) ? pathname.slice(base.length) : pathname
  const play = /^\/play\/([^/]+)/.exec(path)
  if (play) return `${WS_PREFIX}${decodeURIComponent(play[1])}`
  if (/^\/sandbox(\/|$)/.test(path)) return `${WS_PREFIX}sandbox`
  return undefined
}

/** Clear saved workspace state: the current one when known, otherwise every archdraft:ws:* key. */
function resetWorkspaces() {
  try {
    const current = workspaceKeyForPath(window.location.pathname)
    if (current) localStorage.removeItem(current)
    else
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith(WS_PREFIX)) localStorage.removeItem(k)
      }
  } catch {
    /* storage unavailable — reloading is still worth a try */
  }
  window.location.reload()
}

interface Props {
  children: ReactNode
  /** Changing this (e.g. the route path) clears a previous error. */
  resetKey?: string
}

interface State {
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {}

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ArchDraft crashed', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: undefined })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const inWorkspace = !!workspaceKeyForPath(window.location.pathname)
    return (
      <div role="alert" className="flex min-h-dvh items-center justify-center bg-zinc-50 p-6 dark:bg-[#0c0d10]">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#15171c]">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">Something went wrong</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            ArchDraft hit an unexpected error{inWorkspace ? ', possibly caused by saved workspace data' : ''}. Reloading usually helps. If it keeps
            happening, reset the saved workspace — this clears the diagram stored in this browser.
          </p>
          <pre className="mt-3 max-h-24 overflow-auto rounded-lg bg-zinc-100 p-2 font-mono text-[11px] whitespace-pre-wrap text-zinc-600 dark:bg-white/5 dark:text-zinc-400">
            {error.message || String(error)}
          </pre>
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button className="btn bg-rose-600 text-white hover:bg-rose-700" onClick={resetWorkspaces}>
              {inWorkspace ? 'Reset this workspace' : 'Reset saved workspaces'}
            </button>
            <a className="btn-secondary" href={import.meta.env.BASE_URL}>
              Go home
            </a>
          </div>
        </div>
      </div>
    )
  }
}
