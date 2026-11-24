import { useId } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/cn'

/**
 * The "drafted arch": one confident arch stroke crossed by an overshooting
 * construction line — an architectural arch, a drafting mark and an "A".
 */
export function LogoMark({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn('h-7 w-7', className)} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id})`} />
      <path d="M5 19h22" stroke="#c7d2fe" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 25v-9a7 7 0 0 1 14 0v9" stroke="#fff" strokeWidth="2.75" />
    </svg>
  )
}

export function Logo({ className, invert }: { className?: string; invert?: boolean }) {
  return (
    <Link to="/" className={cn('flex items-center gap-2', className)} aria-label="ArchDraft home">
      <LogoMark />
      <span className={cn('text-[15px] font-semibold tracking-tight', invert ? 'text-white' : 'text-zinc-900 dark:text-white')}>
        Arch<span className={invert ? 'text-brand-300' : 'text-brand-600 dark:text-brand-300'}>Draft</span>
      </span>
    </Link>
  )
}
