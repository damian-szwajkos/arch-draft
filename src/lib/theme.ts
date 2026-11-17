import { useEffect, useState } from 'react'
import { readJSON, writeJSON } from './storage'

export type ThemeMode = 'light' | 'dark' | 'system'
const KEY = 'archdraft:theme'

function apply(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  return dark
}

export function initTheme() {
  apply(readJSON<ThemeMode>(KEY, 'system'))
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => readJSON<ThemeMode>(KEY, 'system'))
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    setIsDark(apply(mode))
    writeJSON(KEY, mode)
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setIsDark(apply('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])
  const toggle = () => setMode(isDark ? 'light' : 'dark')
  return { mode, setMode, isDark, toggle }
}
