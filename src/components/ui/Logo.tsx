import { Link } from 'react-router-dom'
import { cn } from '../../lib/cn'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('h-7 w-7', className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#4f46e5" />
      <rect x="6" y="7" width="8" height="7" rx="2" fill="#fff" />
      <rect x="18" y="18" width="8" height="7" rx="2" fill="#fff" />
      <path d="M10 14v4.5a2 2 0 0 0 2 2h6" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="22" cy="10.5" r="3.5" fill="#a5b4fc" />
    </svg>
  )
}

export function Logo({ className, invert }: { className?: string; invert?: boolean }) {
  return (
    <Link to="/" className={cn('flex items-center gap-2', className)} aria-label="ArchDraft home">
      <LogoMark />
      <span className={cn('text-[15px] font-semibold tracking-tight', invert ? 'text-white' : 'text-zinc-900 dark:text-white')}>
        Arch<span className="text-brand-500">Draft</span>
      </span>
    </Link>
  )
}
