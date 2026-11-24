import { X } from 'lucide-react'
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

function focusables(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[inert]') && el.getClientRects().length > 0)
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const titleId = useId()
  const subtitleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const root = rootRef.current
    const panel = panelRef.current
    if (!root || !panel) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // Make the rest of the app inert so focus, clicks and screen readers stay inside the dialog.
    const madeInert: Element[] = []
    for (const el of Array.from(document.body.children)) {
      if (el === root || el.hasAttribute('inert') || el.tagName === 'SCRIPT') continue
      el.setAttribute('inert', '')
      madeInert.push(el)
    }

    // Move focus into the dialog: an element marked data-autofocus, else the panel itself.
    const initial = panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel
    initial.focus({ preventScroll: true })

    // Escape pressed while focus is somewhere outside the dialog (e.g. on <body>). Captured on
    // window so canvas shortcuts behind the modal never see it.
    const onWindowKey = (e: KeyboardEvent) => {
      if (root.contains(e.target as Node)) return
      e.stopPropagation()
      if (e.key === 'Escape') closeRef.current()
      else if (e.key === 'Tab') {
        e.preventDefault()
        ;(focusables(panel)[0] ?? panel).focus()
      }
    }
    window.addEventListener('keydown', onWindowKey, true)

    return () => {
      window.removeEventListener('keydown', onWindowKey, true)
      for (const el of madeInert) el.removeAttribute('inert')
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true })
    }
  }, [open])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Keep every key press inside the modal away from global listeners (e.g. canvas shortcuts).
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panelRef.current) return
    const items = focusables(panelRef.current)
    if (!items.length) {
      e.preventDefault()
      panelRef.current.focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === panelRef.current || !panelRef.current.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }

  if (!open) return null
  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'panel relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-b-none outline-none sm:rounded-2xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-xl',
          size === 'lg' && 'sm:max-w-3xl',
          size === 'xl' && 'sm:max-w-6xl',
        )}
      >
        <div className="flex items-start gap-4 border-b border-zinc-100 px-5 py-4 dark:border-white/10">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-zinc-900 dark:text-white">
              {title}
            </h2>
            {subtitle && (
              <p id={subtitleId} className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                {subtitle}
              </p>
            )}
          </div>
          <button className="icon-btn -mr-1" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-white/10">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
