/**
 * Modèle de données de Browsy, calqué sur Arc :
 * - un profil = une session isolée (cookies, logins, extensions) ;
 * - un Space appartient à un profil et a ses onglets épinglés (avec dossiers) et ses onglets du jour ;
 * - les Favorites sont partagés par tous les Spaces d'un même profil.
 *
 * Fonctions pures (mutation d'un état passé en argument) : testables sans Electron.
 */

export type Id = string

export interface Profile {
  id: Id
  name: string
}

export interface SpaceTheme {
  /** Dégradé de la sidebar, couleurs hexadécimales. */
  from: string
  to: string
}

export interface TabNode {
  type: 'tab'
  id: Id
}

export interface FolderNode {
  type: 'folder'
  id: Id
  title: string
  open: boolean
  children: SidebarNode[]
}

export type SidebarNode = TabNode | FolderNode

export interface Space {
  id: Id
  name: string
  /** Emoji ou chaîne vide (initiale du nom affichée à la place). */
  icon: string
  theme: SpaceTheme
  profileId: Id
  pinned: SidebarNode[]
  /** Onglets du jour, le plus récent en premier (comme Arc). */
  today: Id[]
  activeTabId?: Id
}

export interface TabRecord {
  id: Id
  url: string
  title: string
  favicon?: string
  /** URL d'origine d'un onglet épinglé ou favori, pour y revenir. */
  pinnedUrl?: string
  createdAt: number
  lastActiveAt: number
}

export interface ArchivedTab {
  url: string
  title: string
  favicon?: string
  spaceId: Id
  archivedAt: number
}

export interface Settings {
  /** Délai avant archivage automatique des onglets du jour (0 = jamais). */
  archiveAfterHours: number
}

export interface PersistedState {
  version: 1
  profiles: Profile[]
  spaces: Space[]
  /** Favorites par profil. */
  favorites: Record<Id, Id[]>
  tabs: Record<Id, TabRecord>
  activeSpaceId: Id
  archive: ArchivedTab[]
  settings: Settings
}

/** État « vivant » d'un onglet chargé (non persisté). */
export interface LiveTab {
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  audible: boolean
  muted: boolean
}

export type Section = 'favorites' | 'pinned' | 'today'

export interface TabLocation {
  section: Section
  spaceId?: Id
  /** Dossier parent (section pinned uniquement). */
  folderId?: Id
}

export const SPACE_THEMES: SpaceTheme[] = [
  { from: '#c9d6ff', to: '#e2e2ff' },
  { from: '#ffd6c9', to: '#ffe9d6' },
  { from: '#c9ffd9', to: '#e2fff0' },
  { from: '#ffc9e6', to: '#ffe2f4' },
  { from: '#fff1c9', to: '#fff8e2' },
  { from: '#c9f3ff', to: '#e2faff' },
  { from: '#dcc9ff', to: '#efe2ff' },
  { from: '#d9d9d9', to: '#efefef' },
]

export const DEFAULT_PROFILE_ID = 'default'
const MAX_ARCHIVE = 500

export function newId(): Id {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export function createInitialState(): PersistedState {
  const space: Space = {
    id: newId(),
    name: 'Perso',
    icon: '',
    theme: SPACE_THEMES[0],
    profileId: DEFAULT_PROFILE_ID,
    pinned: [],
    today: [],
  }
  return {
    version: 1,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: 'Défaut' }],
    spaces: [space],
    favorites: { [DEFAULT_PROFILE_ID]: [] },
    tabs: {},
    activeSpaceId: space.id,
    archive: [],
    settings: { archiveAfterHours: 12 },
  }
}

// ── Lecture ────────────────────────────────────────────────────────────────

export function getSpace(state: PersistedState, spaceId: Id): Space | undefined {
  return state.spaces.find((s) => s.id === spaceId)
}

export function activeSpace(state: PersistedState): Space {
  return getSpace(state, state.activeSpaceId) ?? state.spaces[0]
}

export function favoritesOf(state: PersistedState, profileId: Id): Id[] {
  return (state.favorites[profileId] ??= [])
}

/** Parcourt les nœuds épinglés (dossiers compris), en profondeur. */
export function* walkNodes(nodes: SidebarNode[]): Generator<SidebarNode> {
  for (const node of nodes) {
    yield node
    if (node.type === 'folder') yield* walkNodes(node.children)
  }
}

export function findFolder(nodes: SidebarNode[], folderId: Id): FolderNode | undefined {
  for (const node of walkNodes(nodes)) if (node.type === 'folder' && node.id === folderId) return node
  return undefined
}

/** Où se trouve un onglet ? */
export function locateTab(state: PersistedState, tabId: Id): (TabLocation & { profileId: Id }) | undefined {
  for (const [profileId, favorites] of Object.entries(state.favorites)) {
    if (favorites.includes(tabId)) return { section: 'favorites', profileId }
  }
  for (const space of state.spaces) {
    if (space.today.includes(tabId)) return { section: 'today', spaceId: space.id, profileId: space.profileId }
    const parent = findParentList(space.pinned, tabId)
    if (parent) return { section: 'pinned', spaceId: space.id, folderId: parent.folderId, profileId: space.profileId }
  }
  return undefined
}

function findParentList(nodes: SidebarNode[], tabId: Id, folderId?: Id): { list: SidebarNode[]; folderId?: Id } | undefined {
  for (const node of nodes) {
    if (node.type === 'tab' && node.id === tabId) return { list: nodes, folderId }
    if (node.type === 'folder') {
      const found = findParentList(node.children, tabId, node.id)
      if (found) return found
    }
  }
  return undefined
}

export function profileOfTab(state: PersistedState, tabId: Id): Id {
  return locateTab(state, tabId)?.profileId ?? activeSpace(state).profileId
}

/** Onglets visibles dans la sidebar du Space, dans l'ordre d'affichage (pour ⌘1…9). */
export function visibleTabOrder(state: PersistedState, spaceId: Id): Id[] {
  const space = getSpace(state, spaceId)
  if (!space) return []
  const pinned: Id[] = []
  const collect = (nodes: SidebarNode[]) => {
    for (const node of nodes) {
      if (node.type === 'tab') pinned.push(node.id)
      else if (node.open) collect(node.children)
    }
  }
  collect(space.pinned)
  return [...favoritesOf(state, space.profileId), ...pinned, ...space.today]
}

// ── Mutations ──────────────────────────────────────────────────────────────

/** Retire un onglet de la sidebar (sans supprimer son enregistrement). */
export function detachTab(state: PersistedState, tabId: Id): void {
  for (const favorites of Object.values(state.favorites)) {
    const i = favorites.indexOf(tabId)
    if (i >= 0) favorites.splice(i, 1)
  }
  for (const space of state.spaces) {
    space.today = space.today.filter((id) => id !== tabId)
    const parent = findParentList(space.pinned, tabId)
    if (parent) {
      const i = parent.list.findIndex((n) => n.type === 'tab' && n.id === tabId)
      parent.list.splice(i, 1)
    }
  }
}

export function addTab(state: PersistedState, record: TabRecord, spaceId: Id): void {
  state.tabs[record.id] = record
  getSpace(state, spaceId)?.today.unshift(record.id)
}

/**
 * Déplace un onglet vers une section (drag & drop, épingler, mettre en favori).
 * Un onglet qui entre en favori ou épinglé mémorise son URL d'origine ;
 * un onglet qui retourne dans « aujourd'hui » l'oublie.
 */
export function moveTab(state: PersistedState, tabId: Id, to: TabLocation, index = -1): void {
  const tab = state.tabs[tabId]
  if (!tab) return
  const targetSpace = getSpace(state, to.spaceId ?? state.activeSpaceId) ?? activeSpace(state)
  // Déplacement vers le bas dans la même liste : l'index cible se décale une fois l'onglet retiré.
  const targetList = targetListOf(state, targetSpace, to)
  const currentIndex = targetList?.findIndex((item) => (typeof item === 'string' ? item : item.type === 'tab' && item.id) === tabId) ?? -1
  if (currentIndex >= 0 && index > currentIndex) index -= 1
  detachTab(state, tabId)

  const insert = <T>(list: T[], item: T) => {
    if (index < 0 || index > list.length) list.push(item)
    else list.splice(index, 0, item)
  }

  if (to.section === 'today') {
    tab.pinnedUrl = undefined
    insert(targetSpace.today, tabId)
    return
  }
  tab.pinnedUrl ??= tab.url
  if (to.section === 'favorites') {
    insert(favoritesOf(state, targetSpace.profileId), tabId)
    return
  }
  const folder = to.folderId ? findFolder(targetSpace.pinned, to.folderId) : undefined
  insert(folder ? folder.children : targetSpace.pinned, { type: 'tab', id: tabId } as SidebarNode)
}

function targetListOf(state: PersistedState, space: Space, to: TabLocation): (Id | SidebarNode)[] | undefined {
  if (to.section === 'today') return space.today
  if (to.section === 'favorites') return favoritesOf(state, space.profileId)
  return to.folderId ? findFolder(space.pinned, to.folderId)?.children : space.pinned
}

/** Supprime complètement un onglet. Renvoie l'enregistrement (pour « rouvrir l'onglet fermé »). */
export function removeTab(state: PersistedState, tabId: Id): TabRecord | undefined {
  const record = state.tabs[tabId]
  detachTab(state, tabId)
  delete state.tabs[tabId]
  for (const space of state.spaces) if (space.activeTabId === tabId) space.activeTabId = undefined
  return record
}

export function archiveTab(state: PersistedState, tabId: Id, now = Date.now()): void {
  const location = locateTab(state, tabId)
  const record = removeTab(state, tabId)
  if (!record || !location?.spaceId) return
  state.archive.unshift({ url: record.url, title: record.title, favicon: record.favicon, spaceId: location.spaceId, archivedAt: now })
  state.archive.length = Math.min(state.archive.length, MAX_ARCHIVE)
}

/** Onglets du jour à archiver : inactifs depuis plus de `archiveAfterHours`, hors onglet actif. */
export function tabsToArchive(state: PersistedState, now = Date.now()): Id[] {
  const hours = state.settings.archiveAfterHours
  if (!hours) return []
  const limit = now - hours * 3600 * 1000
  const result: Id[] = []
  for (const space of state.spaces) {
    for (const id of space.today) {
      const tab = state.tabs[id]
      if (tab && id !== space.activeTabId && tab.lastActiveAt < limit) result.push(id)
    }
  }
  return result
}

export function createFolder(state: PersistedState, spaceId: Id, title = 'Nouveau dossier'): FolderNode | undefined {
  const space = getSpace(state, spaceId)
  if (!space) return undefined
  const folder: FolderNode = { type: 'folder', id: newId(), title, open: true, children: [] }
  space.pinned.unshift(folder)
  return folder
}

/** Supprime un dossier ; ses onglets remontent à sa place. */
export function deleteFolder(state: PersistedState, spaceId: Id, folderId: Id): void {
  const space = getSpace(state, spaceId)
  if (!space) return
  const visit = (nodes: SidebarNode[]): boolean => {
    const i = nodes.findIndex((n) => n.type === 'folder' && n.id === folderId)
    if (i >= 0) {
      const folder = nodes[i] as FolderNode
      nodes.splice(i, 1, ...folder.children)
      return true
    }
    return nodes.some((n) => n.type === 'folder' && visit(n.children))
  }
  visit(space.pinned)
}

export function createSpace(state: PersistedState, name: string, profileId: Id = activeSpace(state).profileId): Space {
  const space: Space = {
    id: newId(),
    name,
    icon: '',
    theme: SPACE_THEMES[state.spaces.length % SPACE_THEMES.length],
    profileId,
    pinned: [],
    today: [],
  }
  state.spaces.push(space)
  return space
}

/** Supprime un Space et ses onglets. Refusé s'il n'en reste qu'un. Renvoie les ids d'onglets supprimés. */
export function deleteSpace(state: PersistedState, spaceId: Id): Id[] {
  if (state.spaces.length <= 1) return []
  const space = getSpace(state, spaceId)
  if (!space) return []
  const removed = [...space.today]
  for (const node of walkNodes(space.pinned)) if (node.type === 'tab') removed.push(node.id)
  for (const id of removed) delete state.tabs[id]
  state.spaces = state.spaces.filter((s) => s.id !== spaceId)
  if (state.activeSpaceId === spaceId) state.activeSpaceId = state.spaces[0].id
  return removed
}

/** Répare un état chargé depuis le disque (onglets orphelins, références cassées). */
export function normalizeState(state: PersistedState): PersistedState {
  if (!state.spaces.length) return createInitialState()
  for (const profile of state.profiles) favoritesOf(state, profile.id)
  const referenced = new Set<Id>()
  for (const favorites of Object.values(state.favorites)) {
    const kept = favorites.filter((id) => state.tabs[id])
    favorites.splice(0, favorites.length, ...kept)
    kept.forEach((id) => referenced.add(id))
  }
  const cleanNodes = (nodes: SidebarNode[]): SidebarNode[] =>
    nodes
      .filter((n) => n.type === 'folder' || state.tabs[n.id])
      .map((n) => (n.type === 'folder' ? { ...n, children: cleanNodes(n.children) } : n))
  for (const space of state.spaces) {
    space.today = space.today.filter((id) => state.tabs[id])
    space.pinned = cleanNodes(space.pinned)
    space.today.forEach((id) => referenced.add(id))
    for (const node of walkNodes(space.pinned)) if (node.type === 'tab') referenced.add(node.id)
    if (space.activeTabId && !state.tabs[space.activeTabId]) space.activeTabId = undefined
  }
  for (const id of Object.keys(state.tabs)) if (!referenced.has(id)) delete state.tabs[id]
  if (!getSpace(state, state.activeSpaceId)) state.activeSpaceId = state.spaces[0].id
  state.settings ??= { archiveAfterHours: 12 }
  state.archive ??= []
  return state
}
