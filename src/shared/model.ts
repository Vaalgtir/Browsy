/**
 * Modèle de données de Browsy, calqué sur Arc :
 * - un profil = une session isolée (cookies, logins, extensions) ;
 * - un Space appartient à un profil et a ses onglets épinglés (dossiers, Split Views) et ses onglets du jour ;
 * - les Favorites sont partagés par tous les Spaces d'un même profil.
 *
 * Fonctions pures (mutation d'un état passé en argument) : testables sans Electron.
 */

export type Id = string

export interface Profile {
  id: Id
  name: string
}

export type Appearance = 'auto' | 'light' | 'dark'

export interface SpaceTheme {
  /** 1 à 3 couleurs hexadécimales (couleur unie ou dégradé). */
  colors: string[]
  /** Intensité du grain, 0 à 1. */
  grain: number
  appearance: Appearance
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

/** Split View : 2 à 4 onglets affichés côte à côte, une seule ligne dans la sidebar. */
export interface SplitNode {
  type: 'split'
  id: Id
  tabs: Id[]
  /** Proportions des panneaux (somme = 1). */
  sizes: number[]
}

export type SidebarNode = TabNode | FolderNode | SplitNode
/** Ce qu'on trouve dans les onglets du jour (pas de dossiers). */
export type TodayNode = TabNode | SplitNode

export interface Space {
  id: Id
  name: string
  /** Emoji, « icon:<nom> » (icône intégrée) ou chaîne vide. */
  icon: string
  theme: SpaceTheme
  profileId: Id
  pinned: SidebarNode[]
  /** Onglets du jour, le plus récent en premier (comme Arc). */
  today: TodayNode[]
  activeTabId?: Id
  /** Délai d'archivage propre au Space (sinon réglage global). 0 = jamais. */
  archiveAfterHours?: number
}

export interface TabRecord {
  id: Id
  url: string
  title: string
  /** Nom donné par l'utilisateur (onglets épinglés et favoris). */
  customTitle?: string
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

export type LinkDestination = { kind: 'space'; spaceId: Id } | { kind: 'mostRecent' } | { kind: 'littleArc' }

/** Air Traffic Control : où ouvrir un lien venu d'une autre application. */
export interface LinkRule {
  id: Id
  match: { kind: 'contains' | 'domain'; value: string }
  destination: LinkDestination
}

export type SearchEngineId = 'google' | 'duckduckgo' | 'bing' | 'ecosia' | 'kagi' | 'qwant' | 'perplexity'

export interface Settings {
  /** Délai avant archivage automatique des onglets du jour (0 = jamais). */
  archiveAfterHours: number
  searchEngine: SearchEngineId
  sidebarPosition: 'left' | 'right'
  sidebarWidth: number
  /** Hôtes où le Developer Mode est actif (localhost l'est toujours). */
  devModeHosts: string[]
  linkRules: LinkRule[]
  defaultLinkDestination: LinkDestination
  /** Extensions affichées dans la barre d'URL, par profil. */
  pinnedExtensions: Record<Id, string[]>
  /** Picture-in-Picture automatique en quittant un onglet qui joue une vidéo. */
  autoPip: boolean
  /** Raccourcis personnalisés : identifiant de commande → accélérateur Electron. */
  shortcuts: Record<string, string>
  /** Import depuis Arc déjà proposé. */
  arcImport?: 'done' | 'declined'
}

export interface PersistedState {
  version: 2
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
  /** Erreurs et avertissements de la console depuis le dernier chargement (Developer Mode). */
  consoleErrors: number
  consoleWarnings: number
  zoom: number
}

export type Section = 'favorites' | 'pinned' | 'today'

export interface TabLocation {
  section: Section
  spaceId?: Id
  /** Dossier parent (section pinned uniquement). */
  folderId?: Id
  /** Split View contenant l'onglet. */
  splitId?: Id
}

export const SPACE_PALETTE = [
  '#9db4ff',
  '#b9a4ff',
  '#f2a7d8',
  '#ffa98f',
  '#ffcf7a',
  '#b5e48c',
  '#7fe0b8',
  '#7fd3f0',
  '#c7c7cc',
  '#5b5b66',
]

export const DEFAULT_THEME: SpaceTheme = { colors: ['#9db4ff', '#c7b8ff'], grain: 0.35, appearance: 'auto' }

export const SPACE_ICONS = [
  'star',
  'heart',
  'bolt',
  'folder',
  'code',
  'terminal',
  'briefcase',
  'book',
  'planet',
  'pizza',
  'receipt',
  'music',
  'camera',
  'palette',
  'gamepad',
  'cart',
  'house',
  'leaf',
  'flame',
  'moon',
  'sun',
  'graduation',
  'chart',
  'globe',
] as const

export const DEFAULT_PROFILE_ID = 'default'
const MAX_ARCHIVE = 1000

export function newId(): Id {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export function defaultSettings(): Settings {
  return {
    archiveAfterHours: 12,
    searchEngine: 'google',
    sidebarPosition: 'left',
    sidebarWidth: 260,
    devModeHosts: [],
    linkRules: [],
    defaultLinkDestination: { kind: 'mostRecent' },
    pinnedExtensions: {},
    autoPip: true,
    shortcuts: {},
  }
}

export function createInitialState(): PersistedState {
  const space: Space = {
    id: newId(),
    name: 'Perso',
    icon: 'icon:star',
    theme: DEFAULT_THEME,
    profileId: DEFAULT_PROFILE_ID,
    pinned: [],
    today: [],
  }
  return {
    version: 2,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: 'Défaut' }],
    spaces: [space],
    favorites: { [DEFAULT_PROFILE_ID]: [] },
    tabs: {},
    activeSpaceId: space.id,
    archive: [],
    settings: defaultSettings(),
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

/** Parcourt les nœuds (dossiers compris), en profondeur. */
export function* walkNodes(nodes: SidebarNode[]): Generator<SidebarNode> {
  for (const node of nodes) {
    yield node
    if (node.type === 'folder') yield* walkNodes(node.children)
  }
}

/** Identifiants des onglets contenus dans des nœuds (splits et dossiers compris). */
export function tabIdsIn(nodes: SidebarNode[]): Id[] {
  const ids: Id[] = []
  for (const node of walkNodes(nodes)) {
    if (node.type === 'tab') ids.push(node.id)
    else if (node.type === 'split') ids.push(...node.tabs)
  }
  return ids
}

export function findFolder(nodes: SidebarNode[], folderId: Id): FolderNode | undefined {
  for (const node of walkNodes(nodes)) if (node.type === 'folder' && node.id === folderId) return node
  return undefined
}

export function findSplit(state: PersistedState, splitId: Id): SplitNode | undefined {
  for (const space of state.spaces) {
    for (const node of walkNodes([...space.pinned, ...space.today])) if (node.type === 'split' && node.id === splitId) return node
  }
  return undefined
}

interface NodeParent {
  list: SidebarNode[]
  index: number
  folderId?: Id
}

/** Liste contenant le nœud de l'onglet (ou du split qui le contient). */
function findParent(nodes: SidebarNode[], tabId: Id, folderId?: Id): (NodeParent & { split?: SplitNode }) | undefined {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (node.type === 'tab' && node.id === tabId) return { list: nodes, index, folderId }
    if (node.type === 'split' && node.tabs.includes(tabId)) return { list: nodes, index, folderId, split: node }
    if (node.type === 'folder') {
      const found = findParent(node.children, tabId, node.id)
      if (found) return found
    }
  }
  return undefined
}

/** Où se trouve un onglet ? */
export function locateTab(state: PersistedState, tabId: Id): (TabLocation & { profileId: Id }) | undefined {
  for (const [profileId, favorites] of Object.entries(state.favorites)) {
    if (favorites.includes(tabId)) return { section: 'favorites', profileId }
  }
  for (const space of state.spaces) {
    const today = findParent(space.today, tabId)
    if (today) return { section: 'today', spaceId: space.id, splitId: today.split?.id, profileId: space.profileId }
    const pinned = findParent(space.pinned, tabId)
    if (pinned) {
      return { section: 'pinned', spaceId: space.id, folderId: pinned.folderId, splitId: pinned.split?.id, profileId: space.profileId }
    }
  }
  return undefined
}

export function profileOfTab(state: PersistedState, tabId: Id): Id {
  return locateTab(state, tabId)?.profileId ?? activeSpace(state).profileId
}

/** Onglets affichés ensemble avec cet onglet (Split View), ou l'onglet seul. */
export function splitMembers(state: PersistedState, tabId: Id): { split?: SplitNode; tabs: Id[] } {
  const splitId = locateTab(state, tabId)?.splitId
  const split = splitId ? findSplit(state, splitId) : undefined
  return split ? { split, tabs: split.tabs } : { tabs: [tabId] }
}

/** Onglets visibles dans la sidebar du Space, dans l'ordre d'affichage (pour ⌘1…9). */
export function visibleTabOrder(state: PersistedState, spaceId: Id): Id[] {
  const space = getSpace(state, spaceId)
  if (!space) return []
  const pinned: Id[] = []
  const collect = (nodes: SidebarNode[]) => {
    for (const node of nodes) {
      if (node.type === 'tab') pinned.push(node.id)
      else if (node.type === 'split') pinned.push(node.tabs[0])
      else if (node.open) collect(node.children)
    }
  }
  collect(space.pinned)
  const today = space.today.map((n) => (n.type === 'tab' ? n.id : n.tabs[0]))
  return [...favoritesOf(state, space.profileId), ...pinned, ...today]
}

export function tabTitle(tab: TabRecord): string {
  return tab.customTitle || tab.title || tab.url
}

export function archiveDelayOf(state: PersistedState, space: Space): number {
  return space.archiveAfterHours ?? state.settings.archiveAfterHours
}

// ── Mutations ──────────────────────────────────────────────────────────────

/** Retire un onglet de la sidebar (sans supprimer son enregistrement). Un split réduit à 1 onglet disparaît. */
export function detachTab(state: PersistedState, tabId: Id): void {
  for (const favorites of Object.values(state.favorites)) {
    const i = favorites.indexOf(tabId)
    if (i >= 0) favorites.splice(i, 1)
  }
  for (const space of state.spaces) {
    for (const root of [space.pinned, space.today as SidebarNode[]]) {
      const parent = findParent(root, tabId)
      if (!parent) continue
      if (parent.split) {
        parent.split.tabs = parent.split.tabs.filter((id) => id !== tabId)
        parent.split.sizes = evenSizes(parent.split.tabs.length)
        if (parent.split.tabs.length === 1) parent.list.splice(parent.index, 1, { type: 'tab', id: parent.split.tabs[0] })
      } else {
        parent.list.splice(parent.index, 1)
      }
    }
  }
}

function evenSizes(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n)
}

export function addTab(state: PersistedState, record: TabRecord, spaceId: Id): void {
  state.tabs[record.id] = record
  getSpace(state, spaceId)?.today.unshift({ type: 'tab', id: record.id })
}

function targetListOf(state: PersistedState, space: Space, to: TabLocation): (Id | SidebarNode)[] | undefined {
  if (to.section === 'today') return space.today
  if (to.section === 'favorites') return favoritesOf(state, space.profileId)
  return to.folderId ? findFolder(space.pinned, to.folderId)?.children : space.pinned
}

const nodeTabId = (item: Id | SidebarNode): Id | undefined =>
  typeof item === 'string' ? item : item.type === 'tab' ? item.id : undefined

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
  const currentIndex = targetList?.findIndex((item) => nodeTabId(item) === tabId) ?? -1
  if (currentIndex >= 0 && index > currentIndex) index -= 1
  detachTab(state, tabId)

  const insert = <T>(list: T[], item: T) => {
    if (index < 0 || index > list.length) list.push(item)
    else list.splice(index, 0, item)
  }

  if (to.section === 'today') {
    tab.pinnedUrl = undefined
    tab.customTitle = undefined
    insert(targetSpace.today, { type: 'tab', id: tabId } as TodayNode)
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

/**
 * Crée un Split View à la place du premier onglet (épinglé ou du jour).
 * Les autres onglets sont retirés de leur emplacement. Renvoie le split.
 */
export function createSplit(state: PersistedState, tabIds: Id[]): SplitNode | undefined {
  const ids = [...new Set(tabIds)].filter((id) => state.tabs[id]).slice(0, 4)
  if (ids.length < 2) return undefined
  const first = locateTab(state, ids[0])
  if (!first?.spaceId || first.section === 'favorites') return undefined
  const space = getSpace(state, first.spaceId)!
  for (const id of ids.slice(1)) detachTab(state, id)
  const root = first.section === 'today' ? (space.today as SidebarNode[]) : space.pinned
  const parent = findParent(root, ids[0])
  if (!parent) return undefined
  if (parent.split) {
    // L'onglet de base était déjà dans un split : on l'agrandit.
    parent.split.tabs = [...new Set([...parent.split.tabs, ...ids])].slice(0, 4)
    parent.split.sizes = evenSizes(parent.split.tabs.length)
    return parent.split
  }
  const split: SplitNode = { type: 'split', id: newId(), tabs: ids, sizes: evenSizes(ids.length) }
  parent.list.splice(parent.index, 1, split)
  return split
}

/** Défait un Split View : ses onglets redeviennent des lignes séparées. */
export function dissolveSplit(state: PersistedState, splitId: Id): void {
  for (const space of state.spaces) {
    for (const root of [space.pinned, space.today as SidebarNode[]]) {
      const visit = (nodes: SidebarNode[]): boolean => {
        const i = nodes.findIndex((n) => n.type === 'split' && n.id === splitId)
        if (i >= 0) {
          const split = nodes[i] as SplitNode
          nodes.splice(i, 1, ...split.tabs.map((id) => ({ type: 'tab', id }) as TabNode))
          return true
        }
        return nodes.some((n) => n.type === 'folder' && visit(n.children))
      }
      if (visit(root)) return
    }
  }
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

/** Onglets du jour à archiver : inactifs depuis plus que le délai du Space, hors onglet actif. */
export function tabsToArchive(state: PersistedState, now = Date.now()): Id[] {
  const result: Id[] = []
  for (const space of state.spaces) {
    const hours = archiveDelayOf(state, space)
    if (!hours) continue
    const limit = now - hours * 3600 * 1000
    const active = space.activeTabId ? splitMembers(state, space.activeTabId).tabs : []
    for (const id of tabIdsIn(space.today)) {
      const tab = state.tabs[id]
      if (tab && !active.includes(id) && tab.lastActiveAt < limit) result.push(id)
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
  const color = SPACE_PALETTE[state.spaces.length % SPACE_PALETTE.length]
  const space: Space = {
    id: newId(),
    name,
    icon: `icon:${SPACE_ICONS[state.spaces.length % SPACE_ICONS.length]}`,
    theme: { colors: [color], grain: 0.35, appearance: 'auto' },
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
  const removed = [...tabIdsIn(space.today), ...tabIdsIn(space.pinned)]
  for (const id of removed) delete state.tabs[id]
  state.spaces = state.spaces.filter((s) => s.id !== spaceId)
  if (state.activeSpaceId === spaceId) state.activeSpaceId = state.spaces[0].id
  return removed
}

// ── Migration et réparation ────────────────────────────────────────────────

interface LegacyTheme {
  from?: string
  to?: string
}

/** Répare un état chargé depuis le disque (ancienne version, onglets orphelins, références cassées). */
export function normalizeState(raw: PersistedState): PersistedState {
  const state = raw as PersistedState & { version: number }
  if (!state.spaces?.length) return createInitialState()
  state.settings = { ...defaultSettings(), ...state.settings }
  state.archive ??= []
  state.profiles ??= [{ id: DEFAULT_PROFILE_ID, name: 'Défaut' }]
  state.favorites ??= {}
  state.tabs ??= {}
  for (const profile of state.profiles) favoritesOf(state, profile.id)

  for (const space of state.spaces) {
    // v1 : thème { from, to } et onglets du jour en liste d'identifiants.
    const legacy = space.theme as unknown as LegacyTheme
    if (legacy?.from) space.theme = { colors: [legacy.from, legacy.to ?? legacy.from], grain: 0.35, appearance: 'auto' }
    space.theme ??= { ...DEFAULT_THEME }
    space.theme.colors = space.theme.colors?.length ? space.theme.colors.slice(0, 3) : [...DEFAULT_THEME.colors]
    space.theme.grain ??= 0.35
    space.theme.appearance ??= 'auto'
    space.today = (space.today as unknown as (string | TodayNode)[]).map((n) => (typeof n === 'string' ? { type: 'tab', id: n } : n))
  }
  state.version = 2

  const referenced = new Set<Id>()
  for (const favorites of Object.values(state.favorites)) {
    const kept = favorites.filter((id) => state.tabs[id] && !referenced.has(id))
    favorites.splice(0, favorites.length, ...kept)
    kept.forEach((id) => referenced.add(id))
  }
  const clean = (nodes: SidebarNode[]): SidebarNode[] => {
    const result: SidebarNode[] = []
    for (const node of nodes) {
      if (node.type === 'tab') {
        if (state.tabs[node.id] && !referenced.has(node.id)) {
          referenced.add(node.id)
          result.push(node)
        }
      } else if (node.type === 'folder') {
        result.push({ ...node, children: clean(node.children) })
      } else {
        const tabs = node.tabs.filter((id) => state.tabs[id] && !referenced.has(id))
        tabs.forEach((id) => referenced.add(id))
        if (tabs.length >= 2) result.push({ ...node, tabs, sizes: tabs.length === node.tabs.length ? node.sizes : evenSizes(tabs.length) })
        else if (tabs.length === 1) result.push({ type: 'tab', id: tabs[0] })
      }
    }
    return result
  }
  for (const space of state.spaces) {
    space.pinned = clean(space.pinned)
    space.today = clean(space.today).filter((n): n is TodayNode => n.type !== 'folder')
    if (space.activeTabId && !state.tabs[space.activeTabId]) space.activeTabId = undefined
  }
  for (const id of Object.keys(state.tabs)) if (!referenced.has(id)) delete state.tabs[id]
  if (!getSpace(state, state.activeSpaceId)) state.activeSpaceId = state.spaces[0].id
  return state
}
