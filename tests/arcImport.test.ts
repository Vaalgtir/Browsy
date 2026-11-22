import { describe, expect, it } from 'vitest'
import { convertIcon, convertTheme, importArc, type ArcData } from '../src/main/arcImport'
import { createInitialState, locateTab, tabIdsIn, type FolderNode, type SplitNode } from '../src/shared/model'

const tabItem = (id: string, url: string, title: string | null = null) => ({
  id,
  title,
  childrenIds: [],
  data: { tab: { savedURL: url, savedTitle: `Page ${id}` } },
})

/** Petit extrait au format StorableSidebar.json d'Arc. */
const arc: ArcData = {
  sidebar: {
    sidebar: {
      containers: [
        { global: {} },
        {
          topAppsContainerIDs: [{ default: true }, 'fav'],
          spaces: [
            'S1',
            {
              id: 'S1',
              title: 'Travail',
              profile: { default: true },
              containerIDs: ['unpinned', 'U1', 'pinned', 'P1'],
              customInfo: {
                iconType: { icon: 'code' },
                windowTheme: {
                  background: {
                    single: { _0: { style: { color: { _0: { blendedSingleColor: { _0: { color: { red: 0.2, green: 0.9, blue: 0.5 }, modifiers: { overlay: 'grain', noiseFactor: 0 } } } } } } } },
                  },
                },
              },
            },
          ],
          items: [
            'fav', { id: 'fav', childrenIds: ['f1'], data: { itemContainer: {} } },
            'f1', tabItem('f1', 'https://mail.google.com/'),
            'P1', { id: 'P1', childrenIds: ['t1', 'L1', 'SV'], data: { itemContainer: {} } },
            't1', tabItem('t1', 'https://github.com/', 'Mon GitHub'),
            'L1', { id: 'L1', title: 'Infra', childrenIds: ['t2'], data: { list: {} } },
            't2', tabItem('t2', 'https://coolify.io/'),
            'SV', { id: 'SV', childrenIds: ['t3', 't4'], data: { splitView: { itemWidthFactors: ['t3', 3, 't4', 1] } } },
            't3', tabItem('t3', 'https://a.test/'),
            't4', tabItem('t4', 'https://b.test/'),
            'U1', { id: 'U1', childrenIds: [], data: { itemContainer: {} } },
          ],
        },
      ],
    },
  },
  linkRouting: {
    rules: [
      {
        destination: { space: { _0: { mostRecent: {} } } },
        sourceComponents: [{ componentType: { urlMatch: { _0: { contains: {} }, _1: 'meet.google.com' } } }],
      },
    ],
    defaultDestination: { littleArc: { _0: { mostRecent: {} } } },
  },
  devMode: { state: { enabledHosts: ['github.com', 'staging.exemple.fr'] } },
  pinnedExtensions: { Default: ['lastpass'], 'Profile 9': ['ignorée'] },
  favicon: (id) => (id === 't1' ? 'data:image/png;base64,AAAA' : undefined),
}

describe('import Arc', () => {
  it('remplace un état vierge par les Spaces, épinglés, dossiers, splits et favoris', () => {
    const state = createInitialState()
    const summary = importArc(state, arc)
    expect(summary).toEqual({ spaces: 1, pinned: 4, favorites: 1, devModeHosts: 2, linkRules: 1 })

    const [space] = state.spaces
    expect(space.name).toBe('Travail')
    expect(space.icon).toBe('icon:code')
    expect(space.theme.colors).toEqual(['#33e680'])
    const [github, folder, split] = space.pinned
    expect(state.tabs[(github as { id: string }).id]).toMatchObject({ url: 'https://github.com/', customTitle: 'Mon GitHub', favicon: 'data:image/png;base64,AAAA' })
    expect((folder as FolderNode).title).toBe('Infra')
    expect((split as SplitNode).sizes).toEqual([0.75, 0.25])

    const favorite = state.favorites.default[0]
    expect(locateTab(state, favorite)?.section).toBe('favorites')
    expect(state.settings.devModeHosts).toEqual(['github.com', 'staging.exemple.fr'])
    expect(state.settings.linkRules[0]).toMatchObject({ match: { kind: 'contains', value: 'meet.google.com' }, destination: { kind: 'mostRecent' } })
    expect(state.settings.defaultLinkDestination).toEqual({ kind: 'littleArc' })
    expect(state.settings.pinnedExtensions).toEqual({ default: ['lastpass'] })
  })

  it("s'ajoute à un état existant sans doublonner les favoris", () => {
    const state = createInitialState()
    importArc(state, arc)
    const spacesBefore = state.spaces.length
    importArc(state, arc)
    expect(state.spaces.length).toBe(spacesBefore + 1)
    expect(state.favorites.default.length).toBe(1)
    expect(tabIdsIn(state.spaces[1].pinned).length).toBe(4)
  })

  it('convertit icônes et thèmes', () => {
    expect(convertIcon({ emoji_v2: '🚀' })).toBe('🚀')
    expect(convertIcon({ icon: 'inconnue' })).toBe('icon:star')
    expect(convertTheme(undefined).colors.length).toBeGreaterThan(0)
  })
})
