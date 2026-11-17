import { useEffect, useState } from 'react'
import { getProgress, type ProgressRecord } from './storage'

export function useProgress(): Record<string, ProgressRecord> {
  const [p, setP] = useState(getProgress)
  useEffect(() => {
    const on = () => setP(getProgress())
    window.addEventListener('archdraft:progress', on)
    window.addEventListener('storage', on)
    return () => {
      window.removeEventListener('archdraft:progress', on)
      window.removeEventListener('storage', on)
    }
  }, [])
  return p
}
