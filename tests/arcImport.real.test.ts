import { describe, expect, it } from 'vitest'
import { hasArcData, importArc, readArcData } from '../src/main/arcImport'
import { createInitialState, tabIdsIn } from '../src/shared/model'

// Essai à blanc sur les vraies données d'Arc (lecture seule), ignoré si Arc est absent.
describe.runIf(hasArcData())('import Arc (données réelles, à blanc)', () => {
  it('importe sans erreur', () => {
    const state = createInitialState()
    const summary = importArc(state, readArcData())
    const withFavicon = Object.values(state.tabs).filter((t) => t.favicon).length
    expect(withFavicon).toBeGreaterThan(0)
    expect(tabIdsIn(state.spaces[0].pinned).length).toBeGreaterThanOrEqual(0)
    expect(summary.spaces).toBeGreaterThan(0)
  })
})
