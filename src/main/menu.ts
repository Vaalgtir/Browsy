import { Menu, app, type MenuItemConstructorOptions } from 'electron'
import type { Browser } from './Browser'
import { COMMANDS, acceleratorOf, type MenuName } from './commands'

const MENUS: MenuName[] = ['Fichier', 'Édition', 'Présentation', 'Historique', 'Onglets', 'Spaces']

/** Rôles standards de macOS en tête du menu Édition. */
const EDIT_ROLES: MenuItemConstructorOptions[] = [
  { role: 'undo', label: 'Annuler' },
  { role: 'redo', label: 'Rétablir' },
  { type: 'separator' },
  { role: 'cut', label: 'Couper' },
  { role: 'copy', label: 'Copier' },
  { role: 'paste', label: 'Coller' },
  { role: 'pasteAndMatchStyle', label: 'Coller sans mise en forme' },
  { role: 'selectAll', label: 'Tout sélectionner' },
]

/**
 * Menu de l'application, construit depuis le registre des commandes
 * avec les raccourcis personnalisés. Les commandes s'appliquent à la fenêtre active.
 */
export function buildMenu(focused: () => Browser | undefined, overrides: Record<string, string>, openSettings: () => void): void {
  const run = (fn: (b: Browser) => unknown) => () => {
    const browser = focused()
    if (browser) void fn(browser)
  }

  const commandItems = (menu: MenuName): MenuItemConstructorOptions[] => {
    const items: MenuItemConstructorOptions[] = []
    for (const command of COMMANDS.filter((c) => c.menu === menu)) {
      if (command.separator && items.length) items.push({ type: 'separator' })
      items.push({ label: command.label, accelerator: acceleratorOf(command, overrides), click: run(command.run) })
      // Raccourcis secondaires (⌘= pour zoomer…), invisibles dans le menu.
      if (overrides[command.id] === undefined) {
        for (const alias of command.aliases ?? []) items.push({ label: command.label, accelerator: alias, visible: false, click: run(command.run) })
      }
    }
    return items
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: `À propos de ${app.name}` },
        { type: 'separator' },
        { label: 'Réglages…', accelerator: 'CmdOrCtrl+,', click: openSettings },
        {
          label: 'Définir comme navigateur par défaut',
          type: 'checkbox',
          checked: app.isDefaultProtocolClient('https'),
          enabled: app.isPackaged,
          click: (item) => {
            // macOS demande confirmation à l'utilisateur.
            app.setAsDefaultProtocolClient('http')
            app.setAsDefaultProtocolClient('https')
            item.checked = app.isDefaultProtocolClient('https')
          },
        },
        { type: 'separator' },
        { role: 'services', label: 'Services' },
        { type: 'separator' },
        { role: 'hide', label: `Masquer ${app.name}` },
        { role: 'hideOthers', label: 'Masquer les autres' },
        { role: 'unhide', label: 'Tout afficher' },
        { type: 'separator' },
        { role: 'quit', label: `Quitter ${app.name}` },
      ],
    },
    ...MENUS.map((menu) => ({
      label: menu,
      submenu: menu === 'Édition' ? [...EDIT_ROLES, ...commandItems(menu)] : commandItems(menu),
    })),
    { role: 'windowMenu', label: 'Fenêtre' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
