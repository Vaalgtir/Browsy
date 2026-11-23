import { useRef } from 'react'
import { SPACE_PALETTE, type Appearance, type SpaceTheme } from '../../shared/model'
import { SpaceIcon, ICON_NAMES } from './SpaceIcon'
import { backgroundOf, resolveAppearance } from './theme'
import { browsy, useUiState } from './useBrowser'

const APPEARANCES: [Appearance, string][] = [
  ['auto', 'Auto'],
  ['light', 'Clair'],
  ['dark', 'Sombre'],
]

/** Thème et icône d'un Space (comme le sélecteur d'Arc) : modifications appliquées en direct. */
export function ThemeEditor({ spaceId }: { spaceId: string }) {
  const state = useUiState()
  const frame = useRef(0)
  const space = state?.persisted.spaces.find((s) => s.id === spaceId)
  if (!space) return null
  const { theme } = space
  const dispatch = browsy().dispatch

  const update = (patch: Partial<SpaceTheme>) => dispatch({ type: 'space.update', id: spaceId, theme: { ...theme, ...patch } })
  // Les sélecteurs de couleur envoient des valeurs en continu : une mise à jour par image.
  const updateLive = (patch: Partial<SpaceTheme>) => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => update(patch))
  }
  const setCount = (count: number) => {
    const colors = [...theme.colors]
    while (colors.length < count) colors.push(SPACE_PALETTE[(SPACE_PALETTE.indexOf(colors.at(-1) ?? '') + 3 + SPACE_PALETTE.length) % SPACE_PALETTE.length])
    update({ colors: colors.slice(0, count) })
  }
  const setColor = (index: number, color: string, live = false) => {
    const colors = [...theme.colors]
    colors[index] = color
    if (live) updateLive({ colors })
    else update({ colors })
  }

  return (
    <div className="popover theme-editor" role="dialog" aria-label="Thème du Space" onKeyDown={(e) => e.key === 'Escape' && dispatch({ type: 'overlay.close' })}>
      <div className="theme-preview" style={{ background: backgroundOf(theme, resolveAppearance(theme)) }}>
        <SpaceIcon icon={space.icon} name={space.name} size={18} />
        <span>{space.name}</span>
      </div>

      <section className="editor-section">
        <h3>Icône</h3>
        <div className="icon-grid">
          {ICON_NAMES.map((name) => (
            <button
              key={name}
              className={space.icon === `icon:${name}` ? 'icon-choice active' : 'icon-choice'}
              onClick={() => dispatch({ type: 'space.update', id: spaceId, icon: `icon:${name}` })}
              aria-label={name}
            >
              <SpaceIcon icon={`icon:${name}`} size={16} />
            </button>
          ))}
        </div>
        <input
          className="emoji-input"
          placeholder="Ou un emoji…"
          defaultValue={space.icon.startsWith('icon:') ? '' : space.icon}
          maxLength={8}
          onChange={(e) => {
            const value = [...e.target.value.trim()].slice(0, 2).join('')
            if (value) dispatch({ type: 'space.update', id: spaceId, icon: value })
          }}
        />
      </section>

      <section className="editor-section">
        <div className="editor-row">
          <h3>Couleurs</h3>
          <div className="segmented small">
            {[1, 2, 3].map((n) => (
              <button key={n} className={theme.colors.length === n ? 'segment active' : 'segment'} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="color-wells">
          {theme.colors.map((color, i) => (
            <label key={i} className="color-well" style={{ background: color }} title="Choisir une couleur">
              <input type="color" value={color} onChange={(e) => setColor(i, e.target.value, true)} />
            </label>
          ))}
        </div>
        <div className="palette">
          {SPACE_PALETTE.map((color) => (
            <button
              key={color}
              className="palette-swatch"
              style={{ background: color }}
              aria-label={color}
              onClick={() => setColor(theme.colors.length - 1, color)}
            />
          ))}
        </div>
      </section>

      <section className="editor-section">
        <div className="editor-row">
          <h3>Grain</h3>
          <input
            className="slider"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={theme.grain}
            onChange={(e) => updateLive({ grain: Number(e.target.value) })}
          />
        </div>
        <div className="editor-row">
          <h3>Apparence</h3>
          <div className="segmented small">
            {APPEARANCES.map(([value, label]) => (
              <button key={value} className={theme.appearance === value ? 'segment active' : 'segment'} onClick={() => update({ appearance: value })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
