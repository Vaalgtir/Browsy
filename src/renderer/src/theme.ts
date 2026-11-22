import type { SpaceTheme } from '../../shared/model'

/**
 * Applique le thème d'un Space à la page : dégradé de fond, grain, apparence claire ou sombre.
 * En clair, les couleurs sont éclaircies (mélangées à du blanc) comme dans Arc ; en sombre, assombries.
 */

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.9 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

export function resolveAppearance(theme: SpaceTheme): 'light' | 'dark' {
  if (theme.appearance === 'auto') return prefersDark() ? 'dark' : 'light'
  return theme.appearance
}

export function backgroundOf(theme: SpaceTheme, appearance: 'light' | 'dark'): string {
  const tint = (c: string) =>
    appearance === 'light' ? `color-mix(in oklab, ${c} 62%, white)` : `color-mix(in oklab, ${c} 34%, #141416)`
  const colors = theme.colors.length ? theme.colors : ['#9db4ff']
  if (colors.length === 1) {
    const c = tint(colors[0])
    return `linear-gradient(165deg, color-mix(in oklab, ${c} 88%, white), ${c} 55%, color-mix(in oklab, ${c} 92%, black))`
  }
  return `linear-gradient(140deg, ${colors.map(tint).join(', ')})`
}

export function applyTheme(theme: SpaceTheme, root: HTMLElement = document.documentElement): void {
  const appearance = resolveAppearance(theme)
  root.dataset.appearance = appearance
  root.style.setProperty('--space-bg', backgroundOf(theme, appearance))
  root.style.setProperty('--space-accent', theme.colors[0] ?? '#9db4ff')
  root.style.setProperty('--grain', String(Math.min(1, Math.max(0, theme.grain)) * (appearance === 'light' ? 0.5 : 0.35)))
  root.style.setProperty('--noise', NOISE)
}
