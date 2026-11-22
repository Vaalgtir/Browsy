import { describe, expect, it } from 'vitest'
import {
  addTab,
  archiveTab,
  createFolder,
  createInitialState,
  createSpace,
  deleteFolder,
  deleteSpace,
  locateTab,
  moveTab,
  normalizeState,
  removeTab,
  tabsToArchive,
  visibleTabOrder,
  type TabRecord,
} from '../src/shared/model'

const tab = (id: string, lastActiveAt = Date.now()): TabRecord => ({
  id,
  url: `https://${id}.test/`,
  title: id,
  createdAt: 0,
  lastActiveAt,
})

function setup() {
  const state = createInitialState()
  const spaceId = state.activeSpaceId
  addTab(state, tab('a'), spaceId)
  addTab(state, tab('b'), spaceId)
  return { state, spaceId }
}

describe('modèle de la sidebar', () => {
  it('ajoute les nouveaux onglets en haut des onglets du jour', () => {
    const { state } = setup()
    expect(state.spaces[0].today).toEqual(['b', 'a'])
  })

  it("épingler mémorise l'URL d'origine, revenir dans aujourd'hui l'oublie", () => {
    const { state, spaceId } = setup()
    moveTab(state, 'a', { section: 'pinned', spaceId })
    expect(locateTab(state, 'a')?.section).toBe('pinned')
    expect(state.tabs.a.pinnedUrl).toBe('https://a.test/')
    moveTab(state, 'a', { section: 'today', spaceId })
    expect(state.tabs.a.pinnedUrl).toBeUndefined()
  })

  it('les favoris sont partagés entre les Spaces du même profil', () => {
    const { state, spaceId } = setup()
    const other = createSpace(state, 'Travail')
    moveTab(state, 'a', { section: 'favorites', spaceId })
    expect(visibleTabOrder(state, other.id)).toEqual(['a'])
    expect(visibleTabOrder(state, spaceId)).toEqual(['a', 'b'])
  })

  it('range un onglet dans un dossier, et supprimer le dossier garde ses onglets', () => {
    const { state, spaceId } = setup()
    const folder = createFolder(state, spaceId)!
    moveTab(state, 'a', { section: 'pinned', spaceId, folderId: folder.id })
    expect(locateTab(state, 'a')?.folderId).toBe(folder.id)
    deleteFolder(state, spaceId, folder.id)
    expect(state.spaces[0].pinned).toEqual([{ type: 'tab', id: 'a' }])
  })

  it("archive les onglets du jour inactifs, jamais l'onglet actif ni les épinglés", () => {
    const { state, spaceId } = setup()
    const old = Date.now() - 13 * 3600 * 1000
    state.tabs.a.lastActiveAt = old
    state.tabs.b.lastActiveAt = old
    addTab(state, tab('c', old), spaceId)
    moveTab(state, 'c', { section: 'pinned', spaceId })
    state.spaces[0].activeTabId = 'b'
    expect(tabsToArchive(state)).toEqual(['a'])
    archiveTab(state, 'a')
    expect(state.tabs.a).toBeUndefined()
    expect(state.archive[0].url).toBe('https://a.test/')
  })

  it("supprime un Space avec ses onglets, mais jamais le dernier", () => {
    const { state, spaceId } = setup()
    expect(deleteSpace(state, spaceId)).toEqual([])
    const other = createSpace(state, 'Travail')
    expect(deleteSpace(state, spaceId).sort()).toEqual(['a', 'b'])
    expect(state.activeSpaceId).toBe(other.id)
  })

  it('normalise un état incohérent chargé depuis le disque', () => {
    const { state } = setup()
    state.spaces[0].today.push('fantome')
    state.tabs.orphelin = tab('orphelin')
    removeTab(state, 'a')
    normalizeState(state)
    expect(state.spaces[0].today).toEqual(['b'])
    expect(state.tabs.orphelin).toBeUndefined()
  })
})

describe('réordonnancement', () => {
  it('déplace un onglet vers le bas dans la même liste', () => {
    const { state, spaceId } = setup()
    addTab(state, tab('c'), spaceId)
    // today = [c, b, a] ; on lâche « c » juste avant « a » (index 2 dans la liste d'origine)
    moveTab(state, 'c', { section: 'today', spaceId }, 2)
    expect(state.spaces[0].today).toEqual(['b', 'c', 'a'])
  })

  it('déplace un onglet vers le haut dans la même liste', () => {
    const { state, spaceId } = setup()
    addTab(state, tab('c'), spaceId)
    moveTab(state, 'a', { section: 'today', spaceId }, 0)
    expect(state.spaces[0].today).toEqual(['a', 'c', 'b'])
  })
})
