import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_THEME,
  SPACE_ICONS,
  newId,
  tabIdsIn,
  type FolderNode,
  type Id,
  type LinkDestination,
  type LinkRule,
  type PersistedState,
  type SidebarNode,
  type Space,
  type SpaceTheme,
  type TabRecord,
  type TodayNode,
} from '../shared/model'

/**
 * Import depuis Arc : Spaces (thèmes, icônes), onglets épinglés, dossiers, Split Views,
 * favoris, sites en Developer Mode et règles d'Air Traffic Control.
 * Lecture seule des fichiers d'Arc ; l'import s'ajoute à l'état existant.
 */

export const ARC_DIR = join(homedir(), 'Library/Application Support/Arc')

// Formats JSON d'Arc (partiels) : les tableaux alternent clé et valeur ([clé, objet, clé, objet…]).
type Json = Record<string, unknown>
interface ArcItem {
  id: string
  title?: string | null
  parentID?: string | null
  childrenIds: string[]
  createdAt?: number
  data?: {
    tab?: { savedURL?: string; savedTitle?: string; timeLastActiveAt?: number }
    list?: Json
    splitView?: { itemWidthFactors?: (string | number)[] }
  }
}
interface ArcSpace {
  id: string
  title?: string
  profile?: Json
  containerIDs: (string | Json)[]
  customInfo?: { windowTheme?: Json; iconType?: Json }
}

export interface ArcData {
  sidebar: Json
  linkRouting?: Json
  devMode?: { state?: { enabledHosts?: string[] } }
  /** Extensions épinglées dans la barre d'outils, par dossier de profil Chromium (« Default », « Profile 1 »…). */
  pinnedExtensions?: Record<string, string[]>
  /** Favicon en cache d'un élément Arc (data URL), si disponible. */
  favicon?: (itemId: string) => string | undefined
}

export interface ImportSummary {
  spaces: number
  pinned: number
  favorites: number
  devModeHosts: number
  linkRules: number
}

export function hasArcData(dir = ARC_DIR): boolean {
  return existsSync(join(dir, 'StorableSidebar.json'))
}

export function readArcData(dir = ARC_DIR): ArcData {
  const read = (name: string) => {
    try {
      return JSON.parse(readFileSync(join(dir, name), 'utf8'))
    } catch {
      return undefined
    }
  }
  const faviconDir = join(dir, 'SidebarItemsFaviconCache')
  const pinnedExtensions: Record<string, string[]> = {}
  const userData = join(dir, 'User Data')
  if (existsSync(userData)) {
    for (const profileDir of readdirSync(userData)) {
      const prefs = read(join('User Data', profileDir, 'Preferences'))
      const pinned = prefs?.extensions?.pinned_extensions
      if (Array.isArray(pinned)) pinnedExtensions[profileDir] = pinned.filter((id: unknown) => typeof id === 'string')
    }
  }
  return {
    pinnedExtensions,
    sidebar: read('StorableSidebar.json'),
    linkRouting: read('StorableLinkRouting.json'),
    devMode: read('StorableDeveloperModeState.json'),
    favicon: (itemId) => {
      const file = join(faviconDir, createHash('md5').update(itemId).digest('hex'))
      if (!existsSync(file)) return undefined
      return `data:image/png;base64,${readFileSync(file).toString('base64')}`
    },
  }
}

/** Tableau alterné [clé, valeur, clé, valeur…] → paires. */
function pairs<K, V>(list: unknown[] | undefined): [K, V][] {
  const result: [K, V][] = []
  for (let i = 0; list && i + 1 < list.length; i += 2) result.push([list[i] as K, list[i + 1] as V])
  return result
}

function objects<T>(list: unknown[] | undefined): T[] {
  return (list ?? []).filter((x): x is T => typeof x === 'object' && x !== null)
}

// ── Couleurs et thèmes ─────────────────────────────────────────────────────

interface ArcColor {
  red: number
  green: number
  blue: number
}

const isColor = (v: unknown): v is ArcColor => typeof v === 'object' && v !== null && 'red' in v && 'green' in v && 'blue' in v

function hex(c: ArcColor): string {
  const channel = (x: number) =>
    Math.round(Math.min(1, Math.max(0, x)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(c.red)}${channel(c.green)}${channel(c.blue)}`
}

/** Cherche en profondeur la première valeur pour laquelle `match` répond. */
function deepFind<T>(value: unknown, match: (node: Json) => T | undefined): T | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!Array.isArray(value)) {
    const found = match(value as Json)
    if (found !== undefined) return found
  }
  for (const child of Object.values(value as Json)) {
    const found = deepFind(child, match)
    if (found !== undefined) return found
  }
  return undefined
}

export function convertTheme(windowTheme: Json | undefined): SpaceTheme {
  const background = windowTheme?.background
  if (!background) return { ...DEFAULT_THEME }
  // En mode « selon l'apparence », on prend la variante claire comme référence.
  const source = deepFind(background, (n) => (n.light ? n.light : undefined)) ?? background
  const gradient = deepFind(source, (n) => (Array.isArray(n.baseColors) ? (n.baseColors as unknown[]).filter(isColor) : undefined))
  const single = deepFind(source, (n) => (isColor(n.color) ? n.color : undefined))
  const modifiers = deepFind(source, (n) => (n.modifiers && typeof n.modifiers === 'object' ? (n.modifiers as Json) : undefined))
  const colors = (gradient?.length ? gradient : single ? [single] : []).slice(0, 3).map(hex)
  const noise = typeof modifiers?.noiseFactor === 'number' ? modifiers.noiseFactor : 0
  const grain = modifiers?.overlay === 'grain' ? Math.max(noise, 0.25) : noise
  const appearanceBased = deepFind(background, (n) => (n.appearanceBased ? true : undefined))
  return {
    colors: colors.length ? colors : [...DEFAULT_THEME.colors],
    grain: Math.min(1, grain),
    appearance: appearanceBased ? 'auto' : 'light',
  }
}

const ARC_ICON_ALIASES: Record<string, string> = { gamecontroller: 'gamepad', bag: 'cart', cart: 'cart', star: 'star', heart: 'heart' }

export function convertIcon(iconType: Json | undefined): string {
  if (!iconType) return ''
  const emoji = (iconType.emoji_v2 ?? iconType.emoji) as unknown
  if (typeof emoji === 'string') return emoji
  const icon = iconType.icon
  if (typeof icon === 'string') {
    const name = ARC_ICON_ALIASES[icon] ?? icon
    return (SPACE_ICONS as readonly string[]).includes(name) ? `icon:${name}` : 'icon:star'
  }
  return ''
}

// ── Air Traffic Control ────────────────────────────────────────────────────

function convertDestination(raw: unknown, spaceIds: Map<string, Id>): LinkDestination {
  const dest = raw as Json | undefined
  if (dest?.littleArc) return { kind: 'littleArc' }
  const spaceId = deepFind(dest?.space, (n) => (typeof n.id === 'string' ? (n.id as string) : typeof n.spaceID === 'string' ? (n.spaceID as string) : undefined))
  const mapped = spaceId ? spaceIds.get(spaceId) : undefined
  return mapped ? { kind: 'space', spaceId: mapped } : { kind: 'mostRecent' }
}

function convertRules(linkRouting: Json | undefined, spaceIds: Map<string, Id>): { rules: LinkRule[]; fallback?: LinkDestination } {
  const rules: LinkRule[] = []
  for (const rule of objects<Json>(linkRouting?.rules as unknown[])) {
    const destination = convertDestination(rule.destination, spaceIds)
    for (const component of objects<Json>(rule.sourceComponents as unknown[])) {
      const urlMatch = (component.componentType as Json | undefined)?.urlMatch as Json | undefined
      const value = urlMatch?._1
      if (typeof value !== 'string' || !value) continue
      const operator = Object.keys((urlMatch._0 as Json) ?? {})[0]
      rules.push({ id: newId(), match: { kind: operator === 'contains' ? 'contains' : 'domain', value }, destination })
    }
  }
  const fallback = linkRouting?.defaultDestination ? convertDestination(linkRouting.defaultDestination, spaceIds) : undefined
  return { rules, fallback }
}

// ── Import ─────────────────────────────────────────────────────────────────

/** Ajoute les données d'Arc à l'état. Un état vierge (un seul Space vide) est remplacé. */
export function importArc(state: PersistedState, data: ArcData, now = Date.now()): ImportSummary {
  const containers = (data.sidebar?.sidebar as Json | undefined)?.containers as unknown[] | undefined
  const container = objects<Json>(containers).find((c) => c.items)
  if (!container) throw new Error("Données d'Arc introuvables ou dans un format inconnu.")
  const items = new Map(objects<ArcItem>(container.items as unknown[]).map((item) => [item.id, item]))
  const arcSpaces = objects<ArcSpace>(container.spaces as unknown[])
  const summary: ImportSummary = { spaces: 0, pinned: 0, favorites: 0, devModeHosts: 0, linkRules: 0 }

  // Profils : « default » → profil par défaut de Browsy ; les profils Arc personnalisés → nouveaux profils.
  const profileIds = new Map<string, Id>()
  const profileOf = (raw: unknown): Id => {
    const custom = deepFind(raw, (n) => (typeof n.directoryBasename === 'string' ? (n.directoryBasename as string) : undefined))
    if (!custom) return DEFAULT_PROFILE_ID
    let id = profileIds.get(custom)
    if (!id) {
      id = `arc-${custom.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      profileIds.set(custom, id)
      if (!state.profiles.some((p) => p.id === id)) state.profiles.push({ id, name: custom })
      state.favorites[id] ??= []
    }
    return id
  }

  const tabRecord = (item: ArcItem, pinned: boolean): TabRecord | undefined => {
    const url = item.data?.tab?.savedURL
    if (!url) return undefined
    const pageTitle = item.data?.tab?.savedTitle ?? ''
    const record: TabRecord = {
      id: newId(),
      url,
      title: pageTitle,
      customTitle: pinned && item.title && item.title !== pageTitle ? item.title : undefined,
      favicon: data.favicon?.(item.id),
      pinnedUrl: pinned ? url : undefined,
      createdAt: item.createdAt ? Math.round((item.createdAt + 978307200) * 1000) : now,
      lastActiveAt: now,
    }
    state.tabs[record.id] = record
    return record
  }

  const convertNodes = (childIds: string[], pinned: boolean): SidebarNode[] => {
    const nodes: SidebarNode[] = []
    for (const childId of childIds) {
      const item = items.get(childId)
      if (!item?.data) continue
      if (item.data.tab) {
        const record = tabRecord(item, pinned)
        if (record) nodes.push({ type: 'tab', id: record.id })
      } else if (item.data.list) {
        const folder: FolderNode = { type: 'folder', id: newId(), title: item.title || 'Dossier', open: false, children: convertNodes(item.childrenIds, pinned) }
        nodes.push(folder)
      } else if (item.data.splitView) {
        const tabs = item.childrenIds.map((id) => items.get(id)).flatMap((child) => (child ? [tabRecord(child, pinned)] : []))
        const ids = tabs.filter((t): t is TabRecord => !!t).map((t) => t.id)
        const factors = new Map(pairs<string, number>(item.data.splitView.itemWidthFactors))
        if (ids.length >= 2) {
          const raw = item.childrenIds.map((id) => factors.get(id) ?? 1).slice(0, ids.length)
          const total = raw.reduce((a, b) => a + b, 0) || 1
          nodes.push({ type: 'split', id: newId(), tabs: ids.slice(0, 4), sizes: raw.slice(0, 4).map((x) => x / total) })
        } else if (ids.length === 1) {
          nodes.push({ type: 'tab', id: ids[0] })
        }
      }
    }
    return nodes
  }

  // Un état vierge (un seul Space sans onglets) est remplacé plutôt que complété.
  const pristine = state.spaces.length === 1 && !state.spaces[0].pinned.length && !state.spaces[0].today.length
  const spaceIds = new Map<string, Id>()
  const imported: Space[] = []
  for (const arcSpace of arcSpaces) {
    const containers = new Map(pairs<string, string>(arcSpace.containerIDs.filter((x) => typeof x === 'string')))
    const pinnedContainer = items.get(containers.get('pinned') ?? '')
    const todayContainer = items.get(containers.get('unpinned') ?? '')
    const space: Space = {
      id: newId(),
      name: arcSpace.title || 'Space',
      icon: convertIcon(arcSpace.customInfo?.iconType),
      theme: convertTheme(arcSpace.customInfo?.windowTheme),
      profileId: profileOf(arcSpace.profile),
      pinned: pinnedContainer ? convertNodes(pinnedContainer.childrenIds, true) : [],
      today: todayContainer
        ? convertNodes(todayContainer.childrenIds, false).filter((n): n is TodayNode => n.type !== 'folder')
        : [],
    }
    spaceIds.set(arcSpace.id, space.id)
    summary.pinned += tabIdsIn(space.pinned).length
    imported.push(space)
  }
  if (!imported.length) throw new Error("Aucun Space trouvé dans les données d'Arc.")
  summary.spaces = imported.length

  if (pristine) {
    const [old] = state.spaces
    for (const id of tabIdsIn([...old.pinned, ...old.today])) delete state.tabs[id]
    state.spaces = imported
    state.activeSpaceId = imported[0].id
  } else {
    state.spaces.push(...imported)
  }

  // Favoris : un conteneur par profil Arc ([profil, idConteneur, …]).
  for (const [profile, containerId] of pairs<unknown, string>(container.topAppsContainerIDs as unknown[])) {
    const favorites = state.favorites[profileOf(profile)] ??= []
    const existingUrls = new Set(favorites.map((id) => state.tabs[id]?.url))
    for (const node of convertNodes(items.get(containerId)?.childrenIds ?? [], true)) {
      if (node.type !== 'tab') continue
      if (existingUrls.has(state.tabs[node.id].url)) {
        delete state.tabs[node.id]
        continue
      }
      favorites.push(node.id)
      summary.favorites++
    }
  }

  const hosts = data.devMode?.state?.enabledHosts ?? []
  const before = new Set(state.settings.devModeHosts)
  state.settings.devModeHosts = [...new Set([...state.settings.devModeHosts, ...hosts])]
  summary.devModeHosts = hosts.filter((h) => !before.has(h)).length

  const { rules, fallback } = convertRules(data.linkRouting, spaceIds)
  state.settings.linkRules.push(...rules)
  summary.linkRules = rules.length
  if (fallback) state.settings.defaultLinkDestination = fallback

  // Extensions épinglées : « Default » → profil par défaut, les autres → profils importés.
  for (const [profileDir, ids] of Object.entries(data.pinnedExtensions ?? {})) {
    const profileId = profileDir === 'Default' ? DEFAULT_PROFILE_ID : profileIds.get(profileDir)
    if (profileId && !state.settings.pinnedExtensions[profileId]) state.settings.pinnedExtensions[profileId] = ids
  }

  state.settings.arcImport = 'done'
  return summary
}
