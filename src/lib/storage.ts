// All persistence is local to the browser — ArchDraft has no accounts.
// Every access is wrapped because storage can be unavailable (private mode, blocked).

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or unavailable — ignore */
  }
}

export function removeKey(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export interface ProgressRecord {
  bestScore: number
  passed: boolean
  attempts: number
  lastPlayed: number
}

const PROGRESS_KEY = 'archdraft:progress'

export function getProgress(): Record<string, ProgressRecord> {
  return readJSON(PROGRESS_KEY, {})
}

export function recordAttempt(id: string, score: number, passed: boolean) {
  const all = getProgress()
  const prev = all[id]
  all[id] = {
    bestScore: Math.max(prev?.bestScore ?? 0, score),
    passed: (prev?.passed ?? false) || passed,
    attempts: (prev?.attempts ?? 0) + 1,
    lastPlayed: Date.now(),
  }
  writeJSON(PROGRESS_KEY, all)
  window.dispatchEvent(new Event('archdraft:progress'))
}

export function touchScenario(id: string) {
  const all = getProgress()
  if (all[id]) all[id].lastPlayed = Date.now()
  else all[id] = { bestScore: 0, passed: false, attempts: 0, lastPlayed: Date.now() }
  writeJSON(PROGRESS_KEY, all)
}
