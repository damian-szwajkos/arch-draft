import { Menu, Moon, Sun, X } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { cn } from '../lib/cn'
import { GithubIcon } from '../lib/icons'
import { useTheme } from '../lib/theme'
import { Logo } from './ui/Logo'

export const REPO_URL = 'https://github.com/damian-szwajkos/arch-draft'

const LINKS = [
  { to: '/scenarios', label: 'Scenarios' },
  { to: '/concepts', label: 'Concepts' },
  { to: '/sandbox', label: 'Sandbox' },
]

export function SiteHeader({ dark = false }: { dark?: boolean }) {
  const { isDark, toggle } = useTheme()
  const [open, setOpen] = useState(false)
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    cn(
      'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
      dark
        ? isActive
          ? 'text-white'
          : 'text-zinc-300 hover:text-white'
        : isActive
          ? 'text-zinc-900 dark:text-white'
          : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white',
    )
  return (
    <header className={cn('sticky top-0 z-40 border-b backdrop-blur', dark ? 'border-white/10 bg-[#0b0d12]/70' : 'border-zinc-200/70 bg-white/80 dark:border-white/10 dark:bg-[#0b0d12]/80')}>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Logo invert={dark} />
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={linkCls}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={cn('icon-btn hidden sm:inline-flex', dark && 'text-zinc-300 hover:bg-white/10 hover:text-white')} aria-label="GitHub repository">
            <GithubIcon />
          </a>
          <button onClick={toggle} className={cn('icon-btn', dark && 'text-zinc-300 hover:bg-white/10 hover:text-white')} aria-label="Toggle theme">
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <Link to="/scenarios" className={cn('hidden sm:inline-flex', dark ? 'btn bg-white text-zinc-900 hover:bg-zinc-200' : 'btn-dark')}>
            Start drafting
          </Link>
          <button className={cn('icon-btn md:hidden', dark && 'text-zinc-300 hover:bg-white/10')} onClick={() => setOpen((v) => !v)} aria-label="Menu" aria-expanded={open}>
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {open && (
        <nav className={cn('border-t px-4 py-3 md:hidden', dark ? 'border-white/10' : 'border-zinc-200 dark:border-white/10')} aria-label="Mobile">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={(a) => cn(linkCls(a), 'block')} onClick={() => setOpen(false)}>
              {l.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200/70 dark:border-white/10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:px-6">
        <div>
          <Logo />
          <p className="mt-2 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">Learn software architecture by drawing it. Free, open and account-free — your work stays in your browser.</p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-500 sm:ml-auto dark:text-zinc-400" aria-label="Footer">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="hover:text-zinc-900 dark:hover:text-white">
              {l.label}
            </Link>
          ))}
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-zinc-900 dark:hover:text-white">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  )
}
