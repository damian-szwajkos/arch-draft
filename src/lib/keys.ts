/** Platform-aware modifier label for shortcut hints: "⌘" on Apple devices, "Ctrl+" elsewhere. */
export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+'

/** Format a shortcut hint such as `shortcut('Z')` → "⌘Z" / "Ctrl+Z"; `shortcut('Z', true)` adds Shift. */
export function shortcut(key: string, shift = false) {
  return MOD === '⌘' ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`
}
