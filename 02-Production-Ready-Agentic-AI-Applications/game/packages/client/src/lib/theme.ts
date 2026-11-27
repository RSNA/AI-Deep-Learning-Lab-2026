// Theme: follows the device on the first visit, then the player's switch.
import { useSyncExternalStore } from 'react'
import { store } from './storage.ts'

type Theme = 'light' | 'dark'
const listeners = new Set<() => void>()
let forced: Theme | null = null

function system(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function currentTheme(): Theme {
  return forced ?? store.theme() ?? system()
}

function applyTheme() {
  document.documentElement.dataset.theme = currentTheme()
  for (const l of listeners) l()
}

export function setTheme(t: Theme): void {
  store.setTheme(t)
  applyTheme()
}

/** The big screen takes its theme from the host, not from storage. */
export function forceTheme(t: Theme | null): void {
  forced = t
  applyTheme()
}

export function initTheme(): void {
  applyTheme()
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)
  } catch { /* old browser */ }
}

export function useTheme(): Theme {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, currentTheme)
}
